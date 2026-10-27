package com.restofadey.dniesigner

import android.nfc.tech.IsoDep
import org.json.JSONObject

/**
 * Integración APDU oficiales del DNIe peruano.
 *
 * NO inventar comandos. Cuando RENIEC/fabricante entregue documentación o SDK:
 * 1. Implementar [selectAid], [verifyPin], [signDocumentHash] con los APDU reales.
 * 2. Poner [CONFIGURED] = true (o leer BuildConfig / DNIE_APDU_READY).
 * 3. Devolver CMS/PKCS#7 real en Base64 + metadatos de certificado.
 *
 * Hasta entonces [sign] lanza error explícito (no se fabrican firmas falsas).
 */
object OfficialDnieApdu {

    /**
     * true solo cuando los APDU oficiales estén implementados y probados con DNIe real.
     * También puede activarse con BuildConfig si se añade el flag en Gradle.
     */
    const val CONFIGURED: Boolean = false

    fun capabilitiesJson(): JSONObject = JSONObject()
        .put("apdu_configured", CONFIGURED)
        .put("requires_official_sdk", !CONFIGURED)
        .put("note", if (CONFIGURED) "APDU listos" else "APDU REQUIERE DOCUMENTACION RENIEC")

    /**
     * Secuencia: Select AID → Verify PIN → Sign hash → CMS + cert.
     */
    fun sign(
        iso: IsoDep,
        documentHash: String,
        pinChars: CharArray,
    ): JSONObject {
        if (!CONFIGURED) {
            throw UnsupportedOperationException(
                "APDU del DNIe peruano aún no integrados. "
                    + "Obtenga documentación/SDK oficial (Fase 0) e implemente OfficialDnieApdu. "
                    + "No se genera CMS simulado.",
            )
        }

        // --- Puntos de integración (rellenar con APDU oficiales) ---
        selectAid(iso)
        verifyPin(iso, pinChars)
        val cmsBase64 = signDocumentHash(iso, documentHash)
        val certMeta = extractCertificateMeta(iso)

        return JSONObject()
            .put("ok", true)
            .put("mock", false)
            .put("method", "dnie_nfc")
            .put("signature_algorithm", certMeta.optString("signature_algorithm", "SHA256withRSA"))
            .put("signature_value", cmsBase64)
            .put("certificate_serial", certMeta.optString("certificate_serial", ""))
            .put("certificate_subject", certMeta.optString("certificate_subject", ""))
            .put("certificate_issuer", certMeta.optString("certificate_issuer", ""))
            .put("certificate_valid_from", certMeta.optString("certificate_valid_from", ""))
            .put("certificate_valid_to", certMeta.optString("certificate_valid_to", ""))
            .put("document_hash", documentHash)
            .put("validation_status", "PENDING_SERVER_PKI")
    }

    @Suppress("UNUSED_PARAMETER")
    private fun selectAid(iso: IsoDep) {
        // TODO_REQUIERE_VALIDACION_TECNICA: SELECT por AID oficial
        throw UnsupportedOperationException("selectAid: pendiente documentación oficial")
    }

    @Suppress("UNUSED_PARAMETER")
    private fun verifyPin(iso: IsoDep, pinChars: CharArray) {
        // TODO_REQUIERE_VALIDACION_TECNICA: VERIFY PIN (PIN solo aquí)
        throw UnsupportedOperationException("verifyPin: pendiente documentación oficial")
    }

    @Suppress("UNUSED_PARAMETER")
    private fun signDocumentHash(iso: IsoDep, documentHash: String): String {
        // TODO_REQUIERE_VALIDACION_TECNICA: operación de firma → CMS Base64
        throw UnsupportedOperationException("signDocumentHash: pendiente documentación oficial")
    }

    @Suppress("UNUSED_PARAMETER")
    private fun extractCertificateMeta(iso: IsoDep): JSONObject {
        return JSONObject()
    }
}
