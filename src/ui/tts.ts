/** Text-to-speech with a Thai voice (`speechSynthesis`, docs/plan.md §2.1). */

export function thaiVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  return synth.getVoices().find((voice) => voice.lang.toLowerCase().startsWith('th'));
}

/** Speaks `text`; resolves false when no Thai voice can say it. */
export function speakThai(
  text: string,
  synth: SpeechSynthesis = speechSynthesis,
): Promise<boolean> {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'th-TH';
    utterance.rate = 0.9;
    const voice = thaiVoice(synth);
    if (voice) utterance.voice = voice;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    synth.cancel();
    synth.speak(utterance);
    // Some platforms neither speak nor report an error without a voice.
    if (!voice && synth.getVoices().length > 0) setTimeout(() => resolve(synth.speaking), 1500);
  });
}
