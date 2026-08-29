package com.restofadey.dniesigner

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Cliente HTTP del canal móvil (sin JWT; el temporary_token es el secreto).
 * Nunca envía campos pin/password/clave/puk.
 */
class SignApiClient(private val apiOrigin: String) {

    fun getSession(token: String): JSONObject {
        val url = URL("${apiOrigin.trimEnd('/')}/api/contrato/sign/mobile/$token")
        return request(url, "GET", null)
    }

    fun submitSignature(token: String, devicePayload: JSONObject): JSONObject {
        for (key in devicePayload.keys()) {
            if (key.contains("pin", true) || key.contains("password", true)
                || key.contains("clave", true) || key.contains("puk", true)
            ) {
                throw IllegalArgumentException("Campo prohibido en payload: $key")
            }
        }
        val url = URL("${apiOrigin.trimEnd('/')}/api/contrato/sign/mobile/$token")
        return request(url, "POST", devicePayload.toString())
    }

    private fun request(url: URL, method: String, body: String?): JSONObject {
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 20000
            readTimeout = 20000
            setRequestProperty("Content-Type", "application/json")
            doInput = true
            if (body != null) {
                doOutput = true
                outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.bufferedReader()?.readText() ?: ""
        val json = if (text.isBlank()) JSONObject() else JSONObject(text)
        if (code !in 200..299) {
            throw IllegalStateException(json.optString("error", "HTTP $code"))
        }
        return json
    }
}
