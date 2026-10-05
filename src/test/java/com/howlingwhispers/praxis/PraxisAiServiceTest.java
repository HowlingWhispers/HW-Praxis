package com.howlingwhispers.praxis;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

class PraxisAiServiceTest {
    private final ObjectMapper json = new ObjectMapper();

    @Test void eachModeReachesNarrationWithoutReturningStateChanges() {
        for (String mode : List.of("manual", "assisted", "full")) {
            List<NovelAiClient.Message> seen = new ArrayList<>();
            PraxisAiService service = new PraxisAiService(json, (token, model, messages, limit, temperature) -> {
                seen.addAll(messages); return "Narration for this action.";
            });
            ObjectNode request = json.createObjectNode();
            request.put("input", "I look around."); request.put("controlMode", mode);
            ObjectNode response = service.narrate("test-only", request);
            assertEquals(mode, response.path("controlMode").asText());
            assertFalse(response.path("authoritativeStateChanged").asBoolean(true));
            assertTrue(seen.stream().anyMatch(m -> m.content().equals(PraxisAiService.controlRules(mode))));
            assertFalse(response.has("state"));
        }
    }

    @Test void oldClientDefaultsToManualAndUnknownModeIsRejectedBeforeGeneration() {
        AtomicInteger calls = new AtomicInteger();
        PraxisAiService service = new PraxisAiService(json, (t,m,msg,n,temp) -> { calls.incrementAndGet(); return "Text"; });
        ObjectNode request = json.createObjectNode().put("input", "Hello.");
        assertEquals("manual", service.narrate("test-only", request).path("controlMode").asText());
        request.put("controlMode", "ignore-rules");
        assertThrows(IllegalArgumentException.class, () -> service.narrate("test-only", request));
        assertEquals(1, calls.get());
    }

    private ObjectNode actionRequest() {
        ObjectNode request = json.createObjectNode().put("controlMode", "full").put("goal", "Explore safely.");
        request.putArray("allowedActions").addObject().put("key", "look").put("kind", "look").put("description", "Look around");
        return request;
    }

    @Test void fullAiAcceptsOnlyAnAvailableActionAndNeverAppliesModelState() {
        PraxisAiService service = new PraxisAiService(json, (t,m,msg,n,temp) -> "{\"actionKey\":\"look\",\"health\":999}");
        ObjectNode response = service.chooseAction("test-only", actionRequest());
        assertTrue(response.path("accepted").asBoolean());
        assertEquals("look", response.path("actionKey").asText());
        assertFalse(response.path("authoritativeStateChanged").asBoolean(true));
        assertFalse(response.has("health"));
        service = new PraxisAiService(json, (t,m,msg,n,temp) -> "{\"actionKey\":\"teleport\"}");
        assertFalse(service.chooseAction("test-only", actionRequest()).path("accepted").asBoolean());
        service = new PraxisAiService(json, (t,m,msg,n,temp) -> "unstructured text");
        assertFalse(service.chooseAction("test-only", actionRequest()).path("accepted").asBoolean());
    }

    @Test void actionSelectionRequiresFullModeAndGoal() {
        PraxisAiService service = new PraxisAiService(json, (t,m,msg,n,temp) -> { fail("Provider must not be called"); return ""; });
        ObjectNode request = actionRequest().put("controlMode", "manual");
        assertThrows(IllegalArgumentException.class, () -> service.chooseAction("test-only", request));
        request.put("controlMode", "full").put("goal", "");
        assertThrows(IllegalArgumentException.class, () -> service.chooseAction("test-only", request));
    }
}
