/*
 * AranChat — จดประชุม (Android): ไมค์ → PCM16 16 kHz mono → WS https://chat.<เซิร์ฟเวอร์>/api/notify/meeting/live
 *   บันทึกใน foreground service (ไมค์) — ปิดจอ/สลับแอประหว่างประชุมได้ · แจ้งเตือนค้างพร้อมปุ่ม "จบประชุม"
 *   server ถอดเป็นข้อความสด และเมื่อจบส่งบทถอดเต็ม + สรุปเข้าแชท ARANKUB AI (notify/meeting.mjs)
 *   เน็ตหลุด: เก็บเสียงในหน่วยความจำ (≤ 30 นาที) แล้วต่อใหม่ด้วย resume · OpenID token ขอใหม่ทุกครั้งที่ต่อ
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

package io.element.android.features.messages.impl.aranchat

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt

enum class AranMeetingPhase { IDLE, STARTING, RECORDING, ENDING, DONE, FAILED }

data class AranMeetingUi(
    val phase: AranMeetingPhase = AranMeetingPhase.IDLE,
    val title: String = "",
    val seconds: Int = 0,
    val captions: Boolean? = null,
    val lines: List<String> = emptyList(),
    val partial: String = "",
    val online: Boolean = true,
    val paused: Boolean = false,
    val level: Float = 0f,
    val note: String? = null,
)

/** สถานะที่หน้าจอ (AranMeetingSheet) กับ service ใช้ร่วมกัน — มีการประชุมได้ทีละรายการต่อเครื่อง */
object AranMeeting {
    private val _ui = MutableStateFlow(AranMeetingUi())
    val ui: StateFlow<AranMeetingUi> = _ui.asStateFlow()
    internal fun update(f: (AranMeetingUi) -> AranMeetingUi) = _ui.update(f)

    /** ขอ OpenID token ใหม่ (ตั้งจากหน้าจอตอนเริ่ม — token หมดอายุใน 1 ชม. จึงต้องขอใหม่ทุกครั้งที่ต่อ) */
    @Volatile internal var tokenProvider: (suspend () -> String)? = null
    @Volatile internal var liveUrl: String = ""

    fun start(context: Context, url: String, title: String, captions: Boolean, token: suspend () -> String) {
        if (_ui.value.phase == AranMeetingPhase.RECORDING || _ui.value.phase == AranMeetingPhase.STARTING) return
        tokenProvider = token
        liveUrl = url
        _ui.value = AranMeetingUi(phase = AranMeetingPhase.STARTING, title = title)
        val i = Intent(context, AranMeetingService::class.java).putExtra("title", title).putExtra("captions", captions)
        ContextCompat.startForegroundService(context, i)
    }

    fun setPaused(context: Context, paused: Boolean) {
        context.startService(Intent(context, AranMeetingService::class.java).setAction(if (paused) ACTION_PAUSE else ACTION_RESUME))
    }

    fun stop(context: Context) {
        context.startService(Intent(context, AranMeetingService::class.java).setAction(ACTION_STOP))
    }

    /** ปิดหน้าผลลัพธ์ (หลังจบ) */
    fun reset() {
        if (_ui.value.phase == AranMeetingPhase.DONE || _ui.value.phase == AranMeetingPhase.FAILED) _ui.value = AranMeetingUi()
    }

    internal const val ACTION_STOP = "aran.meeting.STOP"
    internal const val ACTION_PAUSE = "aran.meeting.PAUSE"
    internal const val ACTION_RESUME = "aran.meeting.RESUME"
}

class AranMeetingService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var record: AudioRecord? = null
    private var ws: WebSocket? = null
    @Volatile private var open = false
    @Volatile private var stopped = false
    @Volatile private var paused = false
    private var session: String? = null
    private var title = ""
    private var captions = true
    private var retry = 0
    private val pending = ArrayDeque<ByteArray>()
    private var wake: PowerManager.WakeLock? = null
    private var samples = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            AranMeeting.ACTION_STOP -> { scope.launch { finish() }; return START_NOT_STICKY }
            AranMeeting.ACTION_PAUSE -> { paused = true; AranMeeting.update { it.copy(paused = true) }; notifyNow(); return START_NOT_STICKY }
            AranMeeting.ACTION_RESUME -> { paused = false; AranMeeting.update { it.copy(paused = false) }; notifyNow(); return START_NOT_STICKY }
        }
        if (record != null) return START_NOT_STICKY
        title = intent?.getStringExtra("title").orEmpty()
        captions = intent?.getBooleanExtra("captions", true) ?: true
        ServiceCompat.startForeground(this, NOTIF_ID, notification(), if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail("ยังไม่ได้อนุญาตไมค์")
            return START_NOT_STICKY
        }
        wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aranchat:meeting").apply { acquire(5 * 60 * 60_000L) }
        startAudio()
        scope.launch { connect() }
        scope.launch { while (!stopped) { delay(1000); notifyNow() } }
        return START_NOT_STICKY
    }

    @SuppressLint("MissingPermission")
    private fun startAudio() {
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        // VOICE_RECOGNITION: ไม่ตัดเสียงเบา/ไกล (เหมาะกับไมค์วางกลางโต๊ะประชุม)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, CHUNK * 4))
        if (rec.state != AudioRecord.STATE_INITIALIZED) { fail("เปิดไมค์ไม่ได้ (แอปอื่นใช้อยู่?)"); return }
        record = rec
        rec.startRecording()
        Thread({
            val buf = ShortArray(CHUNK / 2)
            while (!stopped) {
                val n = rec.read(buf, 0, buf.size)
                if (n <= 0) continue
                var sum = 0.0
                val bytes = ByteArray(n * 2)
                for (i in 0 until n) {
                    val v = buf[i].toInt()
                    sum += v.toDouble() * v
                    bytes[i * 2] = (v and 0xff).toByte()
                    bytes[i * 2 + 1] = (v shr 8 and 0xff).toByte()
                }
                val rms = sqrt(sum / n) / 32768.0
                if (paused) { AranMeeting.update { it.copy(level = 0f) }; continue }
                samples += n
                AranMeeting.update { it.copy(level = rms.toFloat(), seconds = (samples / RATE).toInt()) }
                send(bytes)
            }
        }, "aran-meeting-audio").start()
    }

    @Synchronized
    private fun send(bytes: ByteArray) {
        if (open && pending.isEmpty() && ws?.send(bytes.toByteString()) == true) return
        pending.addLast(bytes)
        while (pending.size > 9000) pending.removeFirst() // ~30 นาที
    }

    @Synchronized
    private fun flush() {
        while (open && pending.isNotEmpty()) { if (ws?.send(pending.first().toByteString()) == true) pending.removeFirst() else break }
    }

    private suspend fun connect() {
        val token = runCatching { AranMeeting.tokenProvider?.invoke() }.getOrNull()
        if (token == null) { reconnectLater(); return }
        val hello = JSONObject().put("openid", token).apply {
            val s = session
            if (s != null) put("type", "resume").put("session", s) else put("type", "start").put("title", title).put("captions", captions)
        }.toString()
        ws = http.newWebSocket(Request.Builder().url(AranMeeting.liveUrl).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { webSocket.send(hello) }
            override fun onMessage(webSocket: WebSocket, text: String) = onServer(webSocket, text)
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) = Unit
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(webSocket)
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = dropped(webSocket)
        })
    }

    private fun onServer(socket: WebSocket, text: String) {
        val e = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (e.optString("type")) {
            "ready" -> {
                session = e.optString("session")
                retry = 0
                open = true
                AranMeeting.update { it.copy(phase = AranMeetingPhase.RECORDING, online = true, captions = e.optBoolean("captions"), note = e.optString("note").ifEmpty { it.note }) }
                flush()
            }
            "partial" -> AranMeeting.update { it.copy(partial = e.optString("text")) }
            "final" -> AranMeeting.update { it.copy(partial = "", lines = (it.lines + e.optString("text")).takeLast(200)) }
            "error" -> {
                val msg = e.optString("message", "ขัดข้อง")
                if (session != null && msg.contains("ปิดไปแล้ว")) {
                    session = null // server รีสตาร์ท — ส่วนก่อนหน้าถอดให้แล้ว เริ่มตอนใหม่ต่อ
                    AranMeeting.update { it.copy(note = "ระบบเพิ่งรีสตาร์ท — ส่วนก่อนหน้าจะได้สรุปแยก บันทึกต่อเป็นตอนใหม่แล้ว") }
                } else if (session == null) {
                    fail(msg)
                } else {
                    AranMeeting.update { it.copy(note = msg) }
                }
            }
        }
    }

    private fun dropped(socket: WebSocket) {
        if (socket != ws) return
        open = false
        if (stopped) return
        AranMeeting.update { it.copy(online = false) }
        reconnectLater()
    }

    private fun reconnectLater() {
        if (stopped) return
        scope.launch {
            delay(minOf(15_000L, 1000L shl minOf(retry++, 4)))
            if (!stopped) connect()
        }
    }

    private suspend fun finish() {
        if (stopped) return
        paused = true
        AranMeeting.update { it.copy(phase = AranMeetingPhase.ENDING) }
        repeat(60) { if (pending.isEmpty()) return@repeat; flush(); delay(500) }
        val ok = open && pending.isEmpty()
        stopped = true
        if (ok) {
            // server ตอบ processing แล้วปิดสาย — รอให้ปิด (สูงสุด 10 วินาที)
            ws?.send("end")
            withTimeoutOrNull(10_000) { while (open) delay(200) }
        }
        AranMeeting.update {
            it.copy(
                phase = AranMeetingPhase.DONE, partial = "",
                note = if (ok) "ส่งแล้ว ✅ บทถอดเสียง + สรุปจะเข้าแชท ARANKUB AI ภายในไม่กี่นาที"
                else "เน็ตขัดข้อง — ส่วนที่ server ได้รับแล้วจะถอด + สรุปให้อัตโนมัติภายใน 10 นาที",
            )
        }
        shutdown()
    }

    private fun fail(msg: String) {
        stopped = true
        AranMeeting.update { it.copy(phase = AranMeetingPhase.FAILED, note = msg) }
        shutdown()
    }

    private fun shutdown() {
        runCatching { record?.stop(); record?.release() }
        record = null
        runCatching { ws?.close(1000, null) }
        runCatching { wake?.release() }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopped = true
        runCatching { record?.release() }
        scope.cancel()
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "จดประชุม", NotificationManager.IMPORTANCE_LOW))
        }
        val s = AranMeeting.ui.value.seconds
        val time = "%d:%02d".format(s / 60, s % 60)
        val stop = PendingIntent.getService(this, 1, Intent(this, AranMeetingService::class.java).setAction(AranMeeting.ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val pause = PendingIntent.getService(
            this, 2,
            Intent(this, AranMeetingService::class.java).setAction(if (paused) AranMeeting.ACTION_RESUME else AranMeeting.ACTION_PAUSE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 3, it, PendingIntent.FLAG_IMMUTABLE) }
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("🎙 ${title.ifBlank { "จดประชุม" }}")
            .setContentText(if (paused) "พักการบันทึก · $time" else "กำลังบันทึก · $time")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, if (paused) "บันทึกต่อ" else "พัก", pause)
            .addAction(0, "จบประชุม", stop)
            .build()
    }

    private fun notifyNow() {
        if (stopped) return
        runCatching { (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, notification()) }
    }

    private companion object {
        const val RATE = 16_000
        const val CHUNK = 6400 // 200 ms ของ PCM16 16 kHz
        const val NOTIF_ID = 0x4A11
        const val CHANNEL = "aran_meeting"
    }
}
