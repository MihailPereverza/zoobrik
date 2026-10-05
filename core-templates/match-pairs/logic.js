export default function (zb) {
  let selected = null;
  let mistakes = 0;
  let matched = 0;
  const buttons = zb.$$('.pair');
  const total = buttons.length / 2;
  buttons.forEach((button) => button.addEventListener('click', () => {
    if (button.classList.contains('done')) return;
    if (!selected || selected.dataset.side === button.dataset.side) {
      buttons.forEach((b) => b.classList.remove('sel'));
      selected = button;
      button.classList.add('sel');
      return;
    }
    if (selected.dataset.key === button.dataset.key) {
      selected.classList.add('done');
      button.classList.add('done');
      selected.classList.remove('sel');
      matched += 1;
      if (matched === total) zb.answer({ mistakes, total });
    } else {
      mistakes += 1;
      [selected, button].forEach((b) => { b.classList.remove('miss'); void b.offsetWidth; b.classList.add('miss'); });
      selected.classList.remove('sel');
    }
    selected = null;
  }));
}
