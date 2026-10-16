const port = chrome.runtime.connect({ name: 'spike' });
const $ = (selector) => document.querySelector(selector);

const LONG_PROMPT =
  'Write a 900-word story in simple Thai about a trip to Chiang Mai, then translate it to English.';

port.onMessage.addListener((message) => {
  if (message.type === 'log')
    $('#log').textContent += `${new Date().toLocaleTimeString()}  ${message.line}\n`;
  if (message.type === 'state') $('#state').textContent = JSON.stringify(message.state, null, 2);
  if (message.type === 'delta') $('#output').textContent += message.delta;
  if (message.type === 'result' && message.cmd === 'models' && Array.isArray(message.result)) {
    $('#model').replaceChildren(
      ...message.result.map(
        ({ slug, displayName }) => new Option(`${displayName} (${slug})`, slug),
      ),
    );
  }
  if (message.type === 'result' && message.error)
    $('#output').textContent += `\n✗ ${message.error}`;
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-cmd]');
  if (!button) return;
  const { cmd, mode, structured, long } = button.dataset;
  const args = { mode };
  if (cmd === 'respond') {
    $('#output').textContent = '';
    args.model = $('#model').value;
    args.prompt = long ? LONG_PROMPT : $('#prompt').value;
    args.structured = Boolean(structured);
    if (!args.model) {
      $('#output').textContent = 'List models first.';
      return;
    }
  }
  port.postMessage({ cmd, args });
});
