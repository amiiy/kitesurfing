// One button: press and hold anywhere (mouse, touch, Space or any gamepad face button/trigger)
// to edge and load the jump, release to pop. R / Start reset; M is handled by audio.js.

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping): 0-3 face, 4-5 bumpers, 6-7 triggers.
const PAD_PRESS = [0, 1, 2, 3, 4, 5, 6, 7];
const PAD_START = 9;

export function createInput({ onReset }) {
  let space = false;
  const pointers = new Set(); // ids of mice/fingers currently down
  let startWasDown = false;

  addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      space = true;
      e.preventDefault(); // no page scroll
    }
    if (e.code === 'KeyR') onReset();
  });
  addEventListener('keyup', (e) => e.code === 'Space' && (space = false));
  addEventListener('pointerdown', (e) => pointers.add(e.pointerId));
  for (const type of ['pointerup', 'pointercancel']) addEventListener(type, (e) => pointers.delete(e.pointerId));
  addEventListener('contextmenu', (e) => e.preventDefault()); // long-press on phones
  addEventListener('blur', () => {
    space = false; // avoid a stuck press after alt-tab
    pointers.clear();
  });

  return {
    read() {
      const pad = firstPad();
      const button = (i) => Boolean(pad?.buttons[i]?.pressed);
      const start = button(PAD_START);
      if (start && !startWasDown) onReset(); // once per press, not every step it's held
      startWasDown = start;
      return { jump: space || pointers.size > 0 || PAD_PRESS.some(button) };
    },
  };
}

// Browsers only expose a pad after its first button press; slots can hold nulls.
function firstPad() {
  for (const pad of navigator.getGamepads?.() ?? []) if (pad?.connected) return pad;
  return null;
}
