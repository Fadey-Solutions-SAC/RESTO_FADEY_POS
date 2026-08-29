package com.restofadey.dniesigner

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * WebView de firma: carga /firmar-contrato?token=… e inyecta el bridge nativo.
 * PIN solo en diálogos nativos (NfcDnieBridge) — nunca en JS ni en red.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var apiBase: String = ""
    private var webBase: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Configurar en BuildConfig / shared prefs en el proyecto Android Studio real.
        apiBase = intent.getStringExtra(EXTRA_API_BASE)
            ?: getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_API, "")
            ?: ""
        webBase = intent.getStringExtra(EXTRA_WEB_BASE)
            ?: getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_WEB, "")
            ?: apiBase

        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(DnieJsBridge(), "RestoFadeyDnieAndroid")

        val token = extractToken(intent)
        if (token.isNullOrBlank()) {
            webView.loadData(
                "<html><body style='font-family:sans-serif;padding:24px'>Escanee el QR del contrato o abra el enlace de firma.</body></html>",
                "text/html",
                "UTF-8",
            )
            return
        }
        val url = "${webBase.trimEnd('/')}/firmar-contrato?token=${Uri.encode(token)}"
        webView.loadUrl(url)
        injectBridgeWhenReady()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val token = extractToken(intent) ?: return
        val url = "${webBase.trimEnd('/')}/firmar-contrato?token=${Uri.encode(token)}"
        webView.loadUrl(url)
        injectBridgeWhenReady()
    }

    private fun injectBridgeWhenReady() {
        webView.postDelayed({
            webView.evaluateJavascript(
                """
                (function(){
                  if (!window.RestoFadeyDnie) {
                    window.RestoFadeyDnie = {
                      getCapabilities: function() {
                        return JSON.parse(window.RestoFadeyDnieAndroid.getCapabilities());
                      },
                      signAsync: function(payload) {
                        return new Promise(function(resolve, reject) {
                          try {
                            var raw = window.RestoFadeyDnieAndroid.sign(JSON.stringify(payload || {}));
                            var obj = JSON.parse(raw);
                            if (obj && obj.error) reject(new Error(obj.error));
                            else resolve(obj);
                          } catch (e) { reject(e); }
                        });
                      }
                    };
                  }
                  if (window.RestoFadeyDniePage && window.RestoFadeyDniePage.onNativeReady) {
                    window.RestoFadeyDniePage.onNativeReady();
                  }
                })();
                """.trimIndent(),
                null,
            )
        }, 600)
    }

    private fun extractToken(intent: Intent?): String? {
        if (intent == null) return null
        val data: Uri? = intent.data
        if (data != null) {
            data.getQueryParameter("token")?.let { return it }
        }
        return intent.getStringExtra(EXTRA_TOKEN)
    }

    inner class DnieJsBridge {
        @JavascriptInterface
        fun getCapabilities(): String {
            return JSONObject()
                .put("nfc", true)
                .put("dnie", true)
                .put("version", "0.3.0-scaffold")
                .put("technical", "APDU REQUIERE VALIDACION TECNICA")
                .toString()
        }

        /**
         * Ejecuta firma local. El PIN se solicita en nativo dentro de NfcDnieBridge.
         * Devuelve JSON del DeviceSignaturePayload (sin PIN).
         */
        @JavascriptInterface
        fun sign(payloadJson: String): String {
            return try {
                val payload = JSONObject(payloadJson)
                val hash = payload.optString("document_hash")
                val result = NfcDnieBridge(this@MainActivity).signDocumentHash(hash)
                result.toString()
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: "Error de firma").toString()
            }
        }
    }

    companion object {
        const val PREFS = "restofadey_dnie"
        const val KEY_API = "api_base"
        const val KEY_WEB = "web_base"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_API_BASE = "api_base"
        const val EXTRA_WEB_BASE = "web_base"
    }
}
