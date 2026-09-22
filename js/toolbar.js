// /js/toolbar.js
// Key bar above the iOS keyboard + keeps the app sized to the visible area.

const KEYS = [
  { label: '$',  text: '$' },
  { label: ',',  text: ', ' },
  { label: '()', text: '()', back: 1 },     // caret lands inside
  { label: '0x', text: '0x' },
  { label: ':',  text: ':' },
  { label: '⇥',  text: '    ' },
  { label: '←',  move: -1 },
  { label: '→',  move: 1 },
  { label: '⌄',  action: 'hide' },
  { label: '▶',  action: 'run' },
];

export function initToolbar({ code, onRun }) {
  const bar = document.getElementById('keybar');

  for (const k of KEYS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = k.label;
    if (k.action === 'run') b.className = 'run';
    // pointerdown + preventDefault: act without stealing focus (keyboard stays up)
    b.addEventListener('pointerdown', e => { e.preventDefault(); press(k); });
    b.addEventListener('mousedown', e => e.preventDefault());
    bar.append(b);
  }

  function press(k) {
    if (k.action === 'run')  return onRun();
    if (k.action === 'hide') return code.blur();
    if (k.move) {
      const p = Math.max(0, Math.min(code.value.length, code.selectionStart + k.move));
      return code.setSelectionRange(p, p);
    }
    document.execCommand('insertText', false, k.text);   // keeps undo + fires input
    if (k.back) {
      const p = code.selectionStart - k.back;
      code.setSelectionRange(p, p);
    }
  }

  // size the app to the visible area, so the bar sits right on top of the keyboard
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    const kb = window.innerHeight - vv.height > 150;
    document.body.style.height = `${vv.height}px`;
    document.body.style.transform = `translateY(${vv.offsetTop}px)`;
    document.body.classList.toggle('kb', kb && document.activeElement === code);
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  code.addEventListener('focus', fit);
  code.addEventListener('blur', () => setTimeout(fit, 50));
  fit();
}
