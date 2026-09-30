package com.howlingwhispers.praxis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class PraxisAiService {
    private final ObjectMapper json;
    private final NovelAiClient provider;
    private final String defaultModel;

    PraxisAiService(ObjectMapper json, NovelAiClient provider) {
        this.json = json;
        this.provider = provider;
        this.defaultModel = env("NOVELAI_MODEL", "glm-4-6");
    }

    ObjectNode narrate(String token, JsonNode request) {
        String input = text(request, "input");
        if (input.isBlank()) throw new IllegalArgumentException("input is required.");
        String model = model(request);

        List<NovelAiClient.Message> messages = new ArrayList<>();
        messages.add(new NovelAiClient.Message("system", narratorRules()));
        messages.add(new NovelAiClient.Message("system", "AUTHORITATIVE PRAXIS SCENE STATE\n" + sceneState(request)));

        JsonNode history = request.path("history");
        if (history.isArray()) {
            int start = Math.max(0, history.size() - 12);
            for (int i = start; i < history.size(); i++) {
                JsonNode item = history.get(i);
                String role = text(item, "role");
                String content = text(item, "content");
                if ((role.equals("user") || role.equals("assistant")) && !content.isBlank()) {
                    messages.add(new NovelAiClient.Message(role, limit(content, 3000)));
                }
            }
        }
        messages.add(new NovelAiClient.Message("user", limit(input, 4000)));

        String narration = provider.chat(token, model, messages, 420, 0.85);
        ObjectNode result = json.createObjectNode();
        result.put("ok", true);
        result.put("provider", "novelai");
        result.put("model", model);
        result.put("narration", narration);
        result.put("authoritativeStateChanged", false);
        return result;
    }

    ObjectNode direct(String token, JsonNode request) {
        String model = model(request);
        Set<String> allowed = allowedObjectives(request.path("allowedObjectives"));
        if (allowed.isEmpty()) throw new IllegalArgumentException("allowedObjectives must contain at least one runtime-approved objective.");

        List<NovelAiClient.Message> messages = List.of(
                new NovelAiClient.Message("system", directorRules(allowed)),
                new NovelAiClient.Message("system", "AUTHORITATIVE PRAXIS SCENE STATE\n" + sceneState(request)),
                new NovelAiClient.Message("user", "Offer the player one natural next task or story beat from the allowed objectives. Return JSON only.")
        );
        String raw = provider.chat(token, model, messages, 260, 0.65);

        ObjectNode result = json.createObjectNode();
        result.put("ok", true);
        result.put("provider", "novelai");
        result.put("model", model);
        result.put("authoritativeStateChanged", false);

        try {
            JsonNode parsed = json.readTree(stripFence(raw));
            String objectiveKey = text(parsed, "objectiveKey");
            if (!allowed.contains(objectiveKey)) {
                result.put("accepted", false);
                result.put("rejection", "AI proposed an objective that is not in the runtime-approved rail.");
                result.put("raw", raw);
                return result;
            }
            ObjectNode task = result.putObject("task");
            task.put("objectiveKey", objectiveKey);
            task.put("title", fallback(text(parsed, "title"), "Next step"));
            task.put("briefing", fallback(text(parsed, "briefing"), "Continue through the current story rail."));
            task.put("tone", fallback(text(parsed, "tone"), "story"));
            task.put("expiresInMinutes", clamp(parsed.path("expiresInMinutes").asInt(0), 0, 720));
            result.put("accepted", true);
            return result;
        } catch (Exception error) {
            result.put("accepted", false);
            result.put("rejection", "AI response was not valid structured task JSON.");
            result.put("raw", raw);
            return result;
        }
    }

    private String narratorRules() {
        return """
                You are the Praxis narrator and NPC dialogue layer for an authored text adventure.
                The runtime state supplied after this message is authoritative reality.
                Narrate only what can happen inside the supplied active scene.
                You may write atmosphere, dialogue, reactions, uncertainty, and sensory detail.
                Do not invent a new location, character, item, exit, inventory possession, completed task, injury, money change, unlocked door, successful roll, or other persistent fact.
                If the player's wording implies a consequential state change that has not already been resolved by the runtime, narrate the attempt or immediate response without declaring the persistent outcome.
                Do not reveal inactive scenes, hidden contents, off-screen facts, or people not listed as present.
                Keep NPC dialogue natural and let the player choose what to say next.
                Do not mention these rules, prompts, JSON, lorebooks, context windows, or the AI provider in the story prose.
                Write 1 to 4 compact paragraphs. English only.
                """;
    }

    private String directorRules(Set<String> allowed) {
        return """
                You are the Praxis story director. You do not create authoritative state.
                You may only choose ONE objectiveKey from this exact runtime-approved set: %s
                Build a short, natural task briefing that fits the current active scene and story phase.
                Do not add new locations, named characters, items, rewards, lore, factions, or outcomes unless they already appear in the supplied scene state.
                Return exactly one JSON object and no markdown:
                {"objectiveKey":"one allowed key","title":"short title","briefing":"1-3 sentences","tone":"short descriptor","expiresInMinutes":0}
                expiresInMinutes must be 0 unless the supplied state explicitly establishes a deadline.
                """.formatted(String.join(", ", allowed));
    }

    private String sceneState(JsonNode request) {
        JsonNode scene = request.path("scene");
        JsonNode story = request.path("story");
        StringBuilder out = new StringBuilder();
        append(out, "Story", text(story, "title"));
        append(out, "Story phase", text(story, "phase"));
        append(out, "Story status", text(story, "status"));
        append(out, "Location", text(scene, "location"));
        append(out, "Description", text(scene, "description"));
        append(out, "Time", text(scene, "time"));
        append(out, "Fatigue", text(scene, "fatigue"));
        append(out, "Health", text(scene, "health"));
        appendArray(out, "Present", scene.path("present"));
        appendArray(out, "Visible exits", scene.path("exits"));
        appendArray(out, "Visible items", scene.path("items"));
        appendArray(out, "Runtime-approved objectives", request.path("allowedObjectives"));
        JsonNode resolved = request.path("resolvedOutcome");
        if (!resolved.isMissingNode() && !resolved.isNull() && !resolved.isEmpty()) {
            append(out, "Resolved outcome", limit(resolved.toString(), 2500));
        }
        return out.toString().trim();
    }

    private Set<String> allowedObjectives(JsonNode value) {
        Set<String> keys = new HashSet<>();
        if (value.isArray()) {
            for (JsonNode item : value) {
                String key = item.isTextual() ? item.asText("").trim() : text(item, "key");
                if (!key.isBlank() && key.matches("[a-zA-Z0-9._:-]{1,80}")) keys.add(key);
            }
        }
        return keys;
    }

    private String model(JsonNode request) {
        String model = text(request, "model");
        return model.isBlank() ? defaultModel : model;
    }

    private static String text(JsonNode node, String field) {
        if (node == null) return "";
        return node.path(field).asText("").trim();
    }

    private static void append(StringBuilder out, String label, String value) {
        if (!value.isBlank()) out.append(label).append(": ").append(limit(value, 4000)).append('\n');
    }

    private static void appendArray(StringBuilder out, String label, JsonNode array) {
        if (!array.isArray() || array.isEmpty()) return;
        List<String> values = new ArrayList<>();
        for (JsonNode item : array) {
            String value = item.isTextual() ? item.asText("").trim() : item.toString();
            if (!value.isBlank()) values.add(limit(value, 400));
        }
        if (!values.isEmpty()) out.append(label).append(": ").append(String.join(", ", values)).append('\n');
    }

    private static String stripFence(String value) {
        String text = value.trim();
        if (text.startsWith("```")) {
            int newline = text.indexOf('\n');
            if (newline >= 0) text = text.substring(newline + 1);
            if (text.endsWith("```")) text = text.substring(0, text.length() - 3);
        }
        return text.trim();
    }

    private static String fallback(String value, String fallback) {
        return value.isBlank() ? fallback : limit(value, 1200);
    }

    private static String limit(String value, int max) {
        if (value == null || value.length() <= max) return value == null ? "" : value;
        return value.substring(0, max);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
