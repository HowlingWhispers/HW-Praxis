package com.howlingwhispers.praxis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

final class NovelAiClient implements PraxisAiService.ChatProvider {
    record Message(String role, String content) {}

    static final class ProviderException extends RuntimeException {
        final int status;
        ProviderException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final ObjectMapper json;
    private final HttpClient http;
    private final URI baseUri;
    private final String authPrefix;

    NovelAiClient(ObjectMapper json) {
        this.json = json;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .build();
        this.baseUri = URI.create(env("NOVELAI_BASE_URL", "https://text.novelai.net"));
        this.authPrefix = env("NOVELAI_AUTH_PREFIX", "Bearer ");
    }

    JsonNode listModels(String token) {
        HttpRequest request = HttpRequest.newBuilder(baseUri.resolve("/oa/v1/models"))
                .timeout(Duration.ofSeconds(30))
                .header("Accept", "application/json")
                .header("Authorization", authorization(token))
                .GET()
                .build();
        return sendJson(request);
    }

    public String chat(String token, String model, List<Message> messages, int maxTokens, double temperature) {
        ObjectNode body = json.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("temperature", temperature);
        body.put("stream", false);
        ArrayNode messageArray = body.putArray("messages");
        for (Message message : messages) {
            ObjectNode item = messageArray.addObject();
            item.put("role", message.role());
            item.put("content", message.content());
        }

        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(baseUri.resolve("/oa/v1/chat/completions"))
                    .timeout(Duration.ofSeconds(90))
                    .header("Accept", "application/json")
                    .header("Content-Type", "application/json")
                    .header("Authorization", authorization(token))
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
        } catch (IOException error) {
            throw new IllegalStateException("Could not encode NovelAI request.", error);
        }

        JsonNode response = sendJson(request);
        JsonNode choices = response.path("choices");
        if (!choices.isArray() || choices.isEmpty()) {
            throw new ProviderException(502, "NovelAI returned no completion choices.");
        }
        JsonNode first = choices.get(0);
        String content = first.path("message").path("content").asText("").trim();
        if (content.isEmpty()) content = first.path("text").asText("").trim();
        if (content.isEmpty()) throw new ProviderException(502, "NovelAI returned an empty completion.");
        return content;
    }

    private JsonNode sendJson(HttpRequest request) {
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (IOException error) {
            throw new ProviderException(502, "Could not reach NovelAI: " + error.getMessage());
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new ProviderException(503, "NovelAI request was interrupted.");
        }

        JsonNode body = null;
        if (!response.body().isBlank()) {
            try {
                body = json.readTree(response.body());
            } catch (Exception ignored) {
                // The status handling below still returns a bounded provider error.
            }
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            String detail = body == null ? "" : body.path("message").asText("");
            if (detail.isBlank()) detail = "NovelAI request failed.";
            throw new ProviderException(response.statusCode(), detail);
        }
        if (body == null) throw new ProviderException(502, "NovelAI returned a non-JSON response.");
        return body;
    }

    private String authorization(String token) {
        String cleaned = token == null ? "" : token.trim();
        if (cleaned.isEmpty()) throw new ProviderException(401, "NovelAI token is required.");
        if (cleaned.regionMatches(true, 0, "Bearer ", 0, 7)) return cleaned;
        return authPrefix + cleaned;
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
