"""Synthesizes the VOZZ trailer soundtrack (128 BPM, A minor) as a stereo WAV.

Everything is generated from oscillators and noise with numpy, so the track is original
and royalty-free. Section timing matches the scene timeline in video/trailer.html.

    python3 video/trailer-music.py out.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 128
B = 60 / BPM
BAR = 4 * B
BARS = 24
N = int(BARS * BAR * SR) + SR  # +1s tail
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
FX = np.zeros(N)  # sent to reverb


def at(t):
    return int(round(t * SR))


def add(buf, t, sig, gain=1.0):
    i = at(t)
    j = min(N, i + len(sig))
    if i < N:
        buf[i:j] += sig[: j - i] * gain


def both(t, sig, gain=1.0, pan=0.0):
    add(L, t, sig, gain * (1 - max(0, pan)))
    add(R, t, sig, gain * (1 + min(0, pan)))


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def kick(gain=1.0):
    t = tt(0.5)
    phase = 2 * np.pi * (45 * t + 110 * (1 - np.exp(-28 * t)) / 28)
    click = rng.standard_normal(len(t)) * np.exp(-t * 400) * 0.3
    return (np.sin(phase) * np.exp(-t * 6.5) + click) * gain


def noise_burst(dur, decay, hp=1):
    t = tt(dur)
    n = rng.standard_normal(len(t))
    for _ in range(hp):
        n = np.diff(n, prepend=0)
    return n * np.exp(-t * decay)


def clap():
    a = noise_burst(0.25, 20, hp=1) * 0.5
    # three quick hits like a clap
    out = np.zeros_like(a)
    for d in (0, 0.011, 0.023):
        k = at(d)
        out[k:] += a[: len(a) - k]
    return out * 0.6


def hat():
    return noise_burst(0.07, 70, hp=2) * 0.18


def saw(freq, dur, harmonics=7):
    t = tt(dur)
    s = np.zeros_like(t)
    for h in range(1, harmonics + 1):
        s += np.sin(2 * np.pi * freq * h * t) / h
    return s


def square(freq, dur, harmonics=5):
    t = tt(dur)
    s = np.zeros_like(t)
    for h in range(1, 2 * harmonics, 2):
        s += np.sin(2 * np.pi * freq * h * t) / h
    return s


def note(n):  # MIDI -> Hz
    return 440 * 2 ** ((n - 69) / 12)


# A minor – F – C – G
CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]
BASS = [33, 29, 36, 31]


def bar_t(b, beat=0):
    return b * BAR + beat * B


def impact(t, gain=1.0):
    d = tt(2.5)
    boom = np.sin(2 * np.pi * (38 + 30 * np.exp(-d * 5)) * d) * np.exp(-d * 1.6)
    crash = noise_burst(2.5, 2.2, hp=1) * 0.35
    both(t, kick(1.2))
    both(t, boom, 0.9 * gain)
    both(t, crash, 0.5 * gain)
    add(FX, t, crash, 0.6 * gain)


def riser(t0, t1, gain=0.35):
    d = tt(t1 - t0)
    p = d / (t1 - t0)
    n = rng.standard_normal(len(d))
    # one-pole lowpass whose cutoff rises over the riser
    out = np.zeros_like(n)
    y = 0.0
    a = 0.02 + 0.9 * p ** 2
    for i in range(len(n)):
        y += a[i] * (n[i] - y)
        out[i] = y
    tone = np.sin(2 * np.pi * (200 + 1800 * p ** 2) * d) * 0.15
    both(t0, (out + tone) * p ** 2, gain)
    add(FX, t0, out * p ** 2, gain * 0.5)


def sidechain(t0, t1):
    """Pump envelope (ducks after every beat) for bass/pads between t0 and t1."""
    d = tt(t1 - t0)
    since = np.mod(d, B)
    return 1 - 0.75 * np.exp(-since * 9)


def pad(t0, t1, chord_idx, gain=0.08, attack=0.4):
    dur = t1 - t0
    d = tt(dur)
    env = np.minimum(1, d / attack) * np.minimum(1, (dur - d) / 0.3 + 0.001)
    s = np.zeros_like(d)
    for n in CHORDS[chord_idx]:
        for det in (-0.12, 0.12):
            s += saw(note(n + 12) * (1 + det / 100), dur, 5)
    both(t0, s * env, gain)
    add(FX, t0, s * env, gain * 0.8)


# ---------- arrangement (bars) ----------
# intro 0-2: heartbeat + drone
for b in range(2):
    for off in (0, 0.32):
        both(bar_t(b) + off, kick(0.55 if off == 0 else 0.4))
pad(0, bar_t(2), 0, gain=0.05, attack=1.5)
riser(bar_t(1), bar_t(2), 0.18)

# words 2-3: four-on-the-floor + clap build + riser
for k in range(4):
    both(bar_t(2, k), kick(0.9))
    both(bar_t(2, k) + B / 2, clap(), 0.5 + 0.15 * k)
riser(bar_t(2), bar_t(3), 0.45)

GROOVE = [(3, 9), (12, 14), (15, 20), (20, 22)]
for g0, g1 in GROOVE:
    for b in range(g0, g1):
        ch = b % 4
        for k in range(4):
            both(bar_t(b, k), kick(1.0))
            both(bar_t(b, k) + B / 2, hat(), 1, pan=0.3)
            if k in (1, 3):
                both(bar_t(b, k), clap(), 0.7)
        # bass, pumped
        bl = saw(note(BASS[ch]), BAR, 6) * sidechain(0, BAR)
        both(bar_t(b), bl, 0.32)
        # 16th arp from bar 5 on
        if b >= 5:
            tones = CHORDS[ch] + [CHORDS[ch][0] + 12]
            for s in range(16):
                n = tones[s % 4] + 12
                d = tt(0.11)
                tone = square(note(n), 0.11, 4) * np.exp(-d * 22)
                both(bar_t(b) + s * B / 4, tone, 0.07, pan=-0.35 if s % 2 else 0.35)
                add(FX, bar_t(b) + s * B / 4, tone, 0.05)

# hot 9-11: alarm over a pumping groove
for b in range(9, 11):
    for k in range(4):
        both(bar_t(b, k), kick(1.1))
        both(bar_t(b, k) + B / 2, hat(), 1.2)
    both(bar_t(b), saw(note(BASS[0]), BAR, 8) * sidechain(0, BAR), 0.36)
    for s in range(8):
        f = 880 if s % 2 == 0 else 660
        d = tt(B / 2 * 0.9)
        both(bar_t(b) + s * B / 2, square(f, B / 2 * 0.9, 3) * np.minimum(1, d * 80), 0.05, pan=0.5 if s % 2 else -0.5)

# cool 11-12: breakdown – pad only, riser into the block
pad(bar_t(11), bar_t(12), 1, gain=0.09, attack=0.2)
riser(bar_t(11), bar_t(12), 0.4)
impact(bar_t(13))

# montage 14-15: snare roll
for s in range(16):
    both(bar_t(14) + s * B / 4, clap(), 0.25 + 0.04 * s)
for k in range(4):
    both(bar_t(14, k), kick(1.0))
both(bar_t(14), saw(note(BASS[2]), BAR, 6) * sidechain(0, BAR), 0.3)

# chain 18-20 already in groove; riser into the final
riser(bar_t(19), bar_t(20), 0.5)

# final 20-24: impact, big pads, groove for 2 bars then out
impact(bar_t(3))
impact(bar_t(20), 1.2)
for b in range(20, 24):
    pad(bar_t(b), bar_t(b + 1), b % 4, gain=0.1, attack=0.05)
both(bar_t(23), kick(1.1))
impact(bar_t(23, 2), 0.6)

# ---------- reverb (convolution with a decaying noise tail) ----------
ir_t = tt(1.8)
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2)
ir /= np.sqrt(np.sum(ir ** 2))
size = 1 << int(np.ceil(np.log2(N + len(ir))))
wet = np.fft.irfft(np.fft.rfft(FX, size) * np.fft.rfft(ir, size), size)[:N]
L += wet * 0.5
R += np.roll(wet, 331) * 0.5

# ---------- master ----------
mix = np.stack([L, R], axis=1)
mix = np.tanh(mix * 1.1)
fade = np.ones(N)
end = at(BARS * BAR)
fade[end - at(1.2):end] = np.linspace(1, 0.25, at(1.2))
fade[end:] = np.linspace(0.25, 0, N - end)
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) / 0.89
pcm = (mix * 32767).astype(np.int16)

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f"wrote {sys.argv[1]} ({N / SR:.1f}s)")
