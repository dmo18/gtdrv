// The travel pad prompt (docs/PLAN_V2.md 3.4): "Drive on to Miami Beach?"
// with Yes and Stay, as a small panel over the game. Made only when there
// is a document; text goes through textContent.
const CSS = `
.rw-tp { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 70; box-sizing: border-box; width: min(420px, calc(100vw - 32px));
  padding: 16px 16px 14px; border-radius: 18px; background: rgba(15,19,26,0.94); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12), 0 16px 40px rgba(0,0,0,0.5);
  color: #f3f5f8; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; }
.rw-tp p { margin: 0 0 14px; font-size: 18px; font-weight: 700; line-height: 24px; }
.rw-tp div { display: flex; gap: 10px; justify-content: center; }
.rw-tp button { flex: 1 1 0; min-width: 120px; height: 56px; font: inherit; font-size: 17px; font-weight: 700; border-radius: 14px; border: 0; cursor: pointer; touch-action: manipulation; }
.rw-tp .rw-tp-yes { background: linear-gradient(180deg, #f28d55, #e2733a); color: #1c0f07; box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }
.rw-tp .rw-tp-stay { background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); color: #f3f5f8; }
.rw-tp button:focus-visible { outline: 2px solid #ffd2b5; outline-offset: 2px; }
`;

export function createTravelPrompt(doc, { onYes, onStay }) {
  if (!doc || !doc.createElement || !doc.body) return null;
  let el = null;
  return {
    isOpen: () => !!el,
    show(text) {
      if (el) return;
      if (!doc.getElementById('rw-tp-style')) {
        const st = doc.createElement('style');
        st.id = 'rw-tp-style';
        st.textContent = CSS;
        doc.head.appendChild(st);
      }
      el = doc.createElement('div');
      el.className = 'rw-tp';
      el.dataset.role = 'travel-prompt';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', text);
      const p = doc.createElement('p');
      p.textContent = text;
      const row = doc.createElement('div');
      const yes = doc.createElement('button');
      yes.type = 'button';
      yes.className = 'rw-tp-yes';
      yes.dataset.role = 'travel-yes';
      yes.textContent = 'Yes';
      const stay = doc.createElement('button');
      stay.type = 'button';
      stay.className = 'rw-tp-stay';
      stay.dataset.role = 'travel-stay';
      stay.textContent = 'Stay';
      yes.addEventListener('click', () => { this.hide(); if (onYes) onYes(); });
      stay.addEventListener('click', () => { this.hide(); if (onStay) onStay(); });
      row.append(yes, stay);
      el.append(p, row);
      doc.body.appendChild(el);
    },
    hide() {
      if (el) el.remove();
      el = null;
    },
  };
}
