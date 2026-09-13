"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ArchiveDTO } from "@/lib/types";

/**
 * The opening message, and an optional recording of it.
 *
 * A recording is stored as a data URL so that it travels inside the export
 * with no service behind it: the exporter embeds it in archive.html and also
 * writes the audio file alongside.
 */
export default function OpeningPage() {
  const [archive, setArchive] = useState<ArchiveDTO | null>(null);
  const [title, setTitle] = useState("");
  const [opening, setOpening] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    api
      .get<{ archive: ArchiveDTO }>("/api/archive")
      .then((r) => {
        setArchive(r.archive);
        setTitle(r.archive.title);
        setOpening(r.archive.opening);
        setAudioUrl(r.archive.openingAudioUrl);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  async function save() {
    setError(null);
    try {
      const r = await api.put<{ archive: ArchiveDTO }>("/api/archive", {
        title,
        opening,
        openingAudioUrl: audioUrl,
      });
      setArchive(r.archive);
      setStatus("Saved. Every copy you export from now on opens with this.");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size > 8 * 1024 * 1024) {
          setError("That recording is over 8MB. Something shorter keeps the exported file easy to email.");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => setAudioUrl(String(reader.result));
        reader.readAsDataURL(blob);
        setStatus("Recorded. Press Save to keep it, then it travels inside every export.");
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(`Could not use the microphone: ${(err as Error).message}`);
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  const missing = !archive?.opening.trim();

  return (
    <main className="prose" style={{ maxWidth: "40rem" }}>
      <h1>The opening message</h1>
      <p className="lede">
        This is shown before anything else to anyone who opens an exported copy of this archive. It is the only place
        you speak to them directly instead of being read sideways through fragments, which makes it the most valuable
        thing in here.
      </p>

      {missing && (
        <div className="offline-banner">
          Nothing written yet. If you only ever write one thing on this screen, write this: who you were addressing,
          and what you wanted them to know.
        </div>
      )}

      <div className="field">
        <span className="label">What this archive is called</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. What I kept — for Anna and Tom"
        />
      </div>

      <div className="field">
        <span className="label">The message</span>
        <textarea
          rows={14}
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          placeholder={"Whoever is reading this…"}
          style={{ fontSize: "1.05rem" }}
        />
      </div>

      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Save
        </button>
        {!recording ? (
          <button onClick={() => void startRecording()}>Record it in your voice</button>
        ) : (
          <button className="danger" onClick={stopRecording}>
            Stop recording
          </button>
        )}
        {audioUrl && (
          <button className="ghost" onClick={() => setAudioUrl(null)}>
            Remove recording
          </button>
        )}
      </div>

      {audioUrl && (
        <div style={{ marginTop: "1rem" }}>
          <audio controls src={audioUrl} style={{ width: "100%" }} />
          <p className="note">
            Stored inside the archive itself, not on a service. The export embeds it in the page and writes the audio
            file next to it.
          </p>
        </div>
      )}

      {status && <p className="note">{status}</p>}
      {error && <p className="err">{error}</p>}

      <h2>Why this one matters more than the rest</h2>
      <p className="note">
        Everything else in this archive is a fragment: true, but sideways. Someone reading it after you will be piecing
        you together from those fragments. This is the one page where you get to address them.
      </p>
    </main>
  );
}
