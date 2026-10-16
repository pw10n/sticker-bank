package com.stickerbank.flows

import com.stickerbank.support.IntegrationTest
import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@IntegrationTest
class RetireAfterEarningFlowIT : FlowTestBase() {
    @Test
    fun `retired and renamed designs stay in a saved pick (BR-8, FR-10-4)`() {
        val parent = setupParent()
        val childId = createChildViaApi(parent)
        val routine = createRoutineViaApi(parent, childId)
        completeTask(childId, "today", routine.taskIds[0]).andExpect(status().isOk)
        val earned = read(completeTask(childId, "today", routine.taskIds[1]).andExpect(status().isOk))
        val stickerId = long(earned, "$.pick.stickerId")
        val choices = longs(earned, "$.pick.choices[*].designId")
        assertThat(choices).hasSize(3)

        send("PUT", "/api/parent/library/designs/${choices[0]}/status", """{"status":"RETIRED"}""", parent)
            .andExpect(status().isOk).andExpect(jsonPath("$.status").value("RETIRED"))

        val library = read(fetch("/api/parent/library/designs", parent).andExpect(status().isOk))
        val artworkKey = JsonPathHelper.first(library, "$.designs[?(@.id == ${choices[1]})].artworkKey")
        send(
            "PUT",
            "/api/parent/library/designs/${choices[1]}",
            """{"name":"Renamed Star","artworkKey":"$artworkKey","categoryId":null}""",
            parent,
        ).andExpect(status().isOk).andExpect(jsonPath("$.name").value("Renamed Star"))

        val pick = read(fetch("/api/stickers/$stickerId/pick").andExpect(status().isOk))
        assertThat(longs(pick, "$.choices[*].designId")).isEqualTo(choices)
        assertThat(text(pick, "$.choices[1].name")).isEqualTo("Renamed Star")
        assertThat(text(pick, "$.status")).isEqualTo("UNCLAIMED")

        claim(stickerId, choices[0]).andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("AVAILABLE"))
            .andExpect(jsonPath("$.design.designId").value(choices[0]))
        fetch("/api/children/$childId/stickers").andExpect(jsonPath("$.items[0].design.designId").value(choices[0]))
    }
}

private object JsonPathHelper {
    fun first(body: String, path: String): String = com.jayway.jsonpath.JsonPath.read<List<String>>(body, path).first()
}
