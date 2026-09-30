package com.howlingwhispers.praxis;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.Executors;

public final class Main {
    private static final ObjectMapper JSON = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(env("PRAXIS_PORT", "8787"));
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        NovelAiClient provider = new NovelAiClient(JSON);
        PraxisAiService ai = new PraxisAiService(JSON, provider);

        server.createContext("/api/v1/health", exchange -> {
            if (!allow(exchange, "GET")) return;
            ObjectNode body = JSON.createObjectNode();
            body.put("ok", true);
            body.put("service", "praxis-ai");
            body.put("version", "0.3.0");
            body.put("provider", "novelai");
            body.put("time", Instant.now().toString());
            sendJson(exchange, 200, body);
        });

        server.createContext("/api/v1/ai/models", guarded("GET", exchange -> {
            String token = token(exchange);
            sendJson(exchange, 200, provider.listModels(token));
        }));

        server.createContext("/api/v1/ai/turn", guarded("POST", exchange -> {
            String token = token(exchange);
            JsonNode request = readJson(exchange);
            sendJson(exchange, 200, ai.narrate(token, request));
        }));

        server.createContext("/api/v1/ai/director", guarded("POST", exchange -> {
            String token = token(exchange);
            JsonNode request = readJson(exchange);
            sendJson(exchange, 200, ai.direct(token, request));
        }));

        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.println("Praxis AI bridge listening on http://127.0.0.1:" + port);
    }

    private static HttpHandler guarded(String method, ThrowingHandler handler) {
        return exchange -> {
            if (!allow(exchange, method)) return;
            try {
                handler.handle(exchange);
            } catch (IllegalArgumentException error) {
                sendError(exchange, 400, error.getMessage());
            } catch (NovelAiClient.ProviderException error) {
                int status = switch (error.status) {
                    case 400 -> 400;
                    case 401 -> 401;
                    case 403 -> 403;
                    case 429 -> 429;
                    default -> 502;
                };
                sendError(exchange, status, error.getMessage());
            } catch (Exception error) {
                error.printStackTrace(System.err);
                sendError(exchange, 500, "Praxis AI bridge failed to process the request.");
            }
        };
    }

    private static boolean allow(HttpExchange exchange, String expectedMethod) throws IOException {
        addCommonHeaders(exchange.getResponseHeaders());
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return false;
        }
        if (!expectedMethod.equalsIgnoreCase(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed.");
            return false;
        }
        return true;
    }

    private static void addCommonHeaders(Headers headers) {
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        String origin = System.getenv("PRAXIS_ALLOWED_ORIGIN");
        if (origin != null && !origin.isBlank()) {
            headers.set("Access-Control-Allow-Origin", origin.trim());
            headers.set("Access-Control-Allow-Headers", "Content-Type, X-NovelAI-Token");
            headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        }
    }

    private static String token(HttpExchange exchange) {
        String token = exchange.getRequestHeaders().getFirst("X-NovelAI-Token");
        if (token == null || token.isBlank()) token = System.getenv("NOVELAI_TOKEN");
        if (token == null || token.isBlank()) {
            throw new NovelAiClient.ProviderException(401, "No NovelAI Persistent API token was supplied.");
        }
        return token.trim();
    }

    private static JsonNode readJson(HttpExchange exchange) throws IOException {
        long declared = parseLong(exchange.getRequestHeaders().getFirst("Content-Length"), -1);
        if (declared > 256_000) throw new IllegalArgumentException("Request body is too large.");
        try (InputStream in = exchange.getRequestBody()) {
            byte[] bytes = in.readNBytes(256_001);
            if (bytes.length > 256_000) throw new IllegalArgumentException("Request body is too large.");
            if (bytes.length == 0) return JSON.createObjectNode();
            JsonNode node = JSON.readTree(bytes);
            if (node == null || !node.isObject()) throw new IllegalArgumentException("JSON object body required.");
            return node;
        }
    }

    private static void sendError(HttpExchange exchange, int status, String message) throws IOException {
        ObjectNode body = JSON.createObjectNode();
        body.put("ok", false);
        body.put("error", message == null || message.isBlank() ? "Request failed." : message);
        sendJson(exchange, status, body);
    }

    private static void sendJson(HttpExchange exchange, int status, JsonNode body) throws IOException {
        addCommonHeaders(exchange.getResponseHeaders());
        byte[] bytes = JSON.writeValueAsBytes(body);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        } finally {
            exchange.close();
        }
    }

    private static long parseLong(String value, long fallback) {
        if (value == null) return fallback;
        try { return Long.parseLong(value.trim()); }
        catch (NumberFormatException ignored) { return fallback; }
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    @FunctionalInterface
    private interface ThrowingHandler {
        void handle(HttpExchange exchange) throws Exception;
    }
}
