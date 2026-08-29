package com.restofadey.dniesigner

import android.app.Activity
import android.app.AlertDialog
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.EditText
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Puente NFC → DNIe.
 *
 * TODO_REQUIERE_VALIDACION_TECNICA:
 * - No inventar APDU del DNIe peruano.
 * - Sustituir [performOfficialApduSign] cuando exista documentación / SDK oficial.
 * - El PIN solo se usa aquí en memoria y se limpia; nunca se serializa ni se envía.
 */
class NfcDnieBridge(private val activity: Activity) {

    fun signDocumentHash(documentHash: String): JSONObject {
        if (documentHash.isBlank()) {
            throw IllegalArgumentException("document_hash vacío")
        }

        val nfc = NfcAdapter.getDefaultAdapter(activity)
            ?: throw IllegalStateException("Este teléfono no tiene NFC")

        if (!nfc.isEnabled) {
            throw IllegalStateException("Active NFC en Ajustes del teléfono")
        }

        val pin = askPinLocalOnly()
            ?: throw IllegalStateException("PIN cancelado")

        return try {
            // Esperar tag: en producción usar enableReaderMode + callback.
            // Scaffold: deja claro el punto de integración APDU.
            performOfficialApduSign(
                documentHash = documentHash,
                pinChars = pin,
                tag = null,
            )
        } finally {
            pin.fill('0')
        }
    }

    /**
     * PLACEHOLDER — REQUIERE VALIDACIÓN TÉCNICA.
     * No envía APDU inventados. Devuelve error explícito hasta integrar SDK/oficial.
     */
    @Suppress("UNUSED_PARAMETER")
    private fun performOfficialApduSign(
        documentHash: String,
        pinChars: CharArray,
        tag: Tag?,
    ): JSONObject {
        // Ejemplo de cómo se usaría IsoDep cuando los APDU estén validados:
        // val iso = tag?.let { IsoDep.get(it) }
        // iso?.connect()
        // iso?.transceive(officialSelectAid)
        // iso?.transceive(officialVerifyPin(pinChars))  // PIN solo aquí
        // val cms = iso?.transceive(officialSign(documentHashBytes))
        // ...

        throw UnsupportedOperationException(
            "REQUIERE VALIDACIÓN TÉCNICA: integrar APDU oficiales del DNIe peruano. " +
                "Hash listo (${documentHash.take(12)}…). PIN usado solo en dispositivo y descartado.",
        )
    }

    /** Diálogo PIN en el hilo UI; el valor no se registra en logs. */
    private fun askPinLocalOnly(): CharArray? {
        val latch = CountDownLatch(1)
        val ref = AtomicReference<CharArray?>(null)
        Handler(Looper.getMainLooper()).post {
            val input = EditText(activity).apply {
                inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
                hint = "PIN del DNIe"
            }
            AlertDialog.Builder(activity)
                .setTitle("PIN del DNIe")
                .setMessage("El PIN no se envía a Resto Fadey.")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("Continuar") { _, _ ->
                    ref.set(input.text?.toString()?.toCharArray())
                    input.text?.clear()
                    latch.countDown()
                }
                .setNegativeButton("Cancelar") { _, _ ->
                    latch.countDown()
                }
                .show()
        }
        latch.await(120, TimeUnit.SECONDS)
        return ref.get()
    }
}
