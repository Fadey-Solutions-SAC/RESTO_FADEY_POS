package com.restofadey.dniesigner

import android.app.Activity
import android.app.AlertDialog
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.EditText
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Puente NFC → DNIe (IsoDep + PIN local + APDU oficiales vía [OfficialDnieApdu]).
 *
 * Reader Mode con [NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK] evita el toast NDEF del sistema.
 * El PIN solo vive en memoria nativa y se limpia; nunca se serializa ni se envía.
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

        val tag = waitForIsoDepTag(nfc, timeoutMs = 90_000)
            ?: throw IllegalStateException(
                "No se detectó el DNIe. Acerque el documento a la parte trasera del teléfono y manténgalo quieto.",
            )

        val pin = askPinLocalOnly()
            ?: throw IllegalStateException("PIN cancelado")

        return try {
            val iso = IsoDep.get(tag)
                ?: throw IllegalStateException("El DNIe no expone IsoDep en este teléfono")
            try {
                iso.timeout = 15_000
                iso.connect()
                OfficialDnieApdu.sign(iso, documentHash, pin)
            } finally {
                try {
                    iso.close()
                } catch (_: Exception) {
                    /* noop */
                }
            }
        } finally {
            pin.fill('0')
        }
    }

    private fun waitForIsoDepTag(nfc: NfcAdapter, timeoutMs: Long): Tag? {
        val latch = CountDownLatch(1)
        val ref = AtomicReference<Tag?>(null)
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK

        val callback = NfcAdapter.ReaderCallback { tag ->
            if (IsoDep.get(tag) == null) return@ReaderCallback
            if (ref.compareAndSet(null, tag)) {
                try {
                    nfc.disableReaderMode(activity)
                } catch (_: Exception) {
                    /* noop */
                }
                latch.countDown()
            }
        }

        activity.runOnUiThread {
            try {
                nfc.enableReaderMode(activity, callback, flags, Bundle())
            } catch (_: Exception) {
                latch.countDown()
            }
        }

        val ok = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        activity.runOnUiThread {
            try {
                nfc.disableReaderMode(activity)
            } catch (_: Exception) {
                /* noop */
            }
        }
        return if (ok) ref.get() else null
    }

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
                .setMessage("DNIe detectado. Escriba el PIN. No se envía a Resto Fadey.")
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
