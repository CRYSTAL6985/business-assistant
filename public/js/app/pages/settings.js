// Settings: profile, password, workspace name, theme, and the danger zone (delete workspace).
import { api, get } from '../api.js';
import { pageHead } from '../table.js';
import { formDialog } from '../form.js';
import { savedTheme, setTheme, THEMES } from '../shell.js';

/** A small inline form: labelled inputs, inline error, busy button, toast on success. */
function inlineForm({ fields, submitLabel, onSubmit }) {
  const error = el('p', { class: 'form-error', role: 'alert' });
  const submit = el('button', { class: 'btn btn-secondary', type: 'submit', text: submitLabel });
  const form = el('form', { class: 'stack', novalidate: true }, ...fields.map((f) => el('div', { class: 'field' },
    el('label', { for: `s-${f.id ?? f.name}`, text: f.label }),
    el('input', { class: `input${f.ltr ? ' ltr' : ''}`, id: `s-${f.id ?? f.name}`, name: f.name, type: f.type ?? 'text', value: f.value ?? '', required: true,
      minlength: f.minlength ?? null, maxlength: f.maxlength ?? null, autocomplete: f.autocomplete ?? 'off', readOnly: f.readOnly ?? false }),
    f.hint ? el('span', { class: 'hint', text: f.hint }) : null)), error, el('div', { class: 'page-actions' }, submit));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    error.textContent = '';
    const invalid = [...form.elements].find((x) => x.willValidate && !x.checkValidity());
    if (invalid) { error.textContent = invalid.validationMessage; invalid.focus(); return; }
    withBusy(submit, async () => {
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); } catch (err) { error.textContent = err.message; }
    });
  });
  return form;
}

const card = (title, note, ...children) => el('section', { class: 'card card-pad cfg-section' },
  el('h2', { text: title }), note ? el('p', { class: 'subtle small', text: note }) : null, ...children);

export async function render(main, { refreshMe }) {
  let s;
  try { s = await get('/api/app/settings'); } catch (err) {
    main.replaceChildren(el('div', { class: 'card empty' }, icon('alert'), el('strong', { text: 'بارگذاری نشد' }), el('p', { text: err.message })));
    return;
  }

  const profile = card('پروفایل', null, inlineForm({
    fields: [{ name: 'name', label: 'نام شما', value: s.user.name, maxlength: 80 }, { name: 'email', label: 'ایمیل ورود', value: s.user.email, ltr: true, readOnly: true, hint: 'ایمیل ورود قابل تغییر نیست.' }],
    submitLabel: 'ذخیره', onSubmit: async (v) => { await api('PUT', '/api/app/settings/profile', { name: v.name }); toast('ذخیره شد'); await refreshMe(); },
  }));

  const password = card('رمز عبور', 'بعد از تغییر، همهٔ دستگاه‌های دیگر از حساب خارج می‌شوند.', inlineForm({
    fields: [
      { name: 'current', label: 'رمز فعلی', type: 'password', autocomplete: 'current-password' },
      { name: 'next', label: 'رمز جدید', type: 'password', minlength: 8, autocomplete: 'new-password', hint: 'حداقل ۸ حرف' },
      { name: 'repeat', label: 'تکرار رمز جدید', type: 'password', minlength: 8, autocomplete: 'new-password' },
    ],
    submitLabel: 'تغییر رمز',
    onSubmit: async (v, form) => {
      if (v.next !== v.repeat) throw new Error('رمز جدید و تکرار آن یکی نیستند');
      await api('PUT', '/api/app/settings/password', { current: v.current, next: v.next });
      form.reset();
      toast('رمز عبور تغییر کرد');
    },
  }));

  const workspace = card('فضای کاری', null, inlineForm({
    fields: [{ name: 'name', id: 'workspace-name', label: 'نام فضای کاری', value: s.workspace.name, minlength: 2, maxlength: 80 }],
    submitLabel: 'ذخیره', onSubmit: async (v) => { await api('PUT', '/api/app/settings/workspace', v); s.workspace.name = v.name; toast('ذخیره شد'); await refreshMe(); },
  }));

  const themeSeg = el('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'پوسته' }, ...THEMES.map((t) => el('button', {
    type: 'button', 'aria-pressed': String(savedTheme() === t.id),
    onclick: (e) => { setTheme(t.id); themeSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); refreshMe(); },
  }, icon(t.icon, 'icon icon-sm'), t.label)));
  const theme = card('پوسته', 'فقط روی همین مرورگر ذخیره می‌شود.', themeSeg);

  const remove = el('button', { class: 'btn btn-danger-solid', type: 'button', text: 'حذف فضای کاری' });
  remove.addEventListener('click', () => formDialog({
    title: 'حذف فضای کاری', danger: true,
    intro: 'همهٔ فروشگاه‌ها، محصولات، سفارش‌ها، گفتگوها و تنظیمات برای همیشه پاک می‌شوند و از حساب خارج می‌شوید. این کار برگشت‌پذیر نیست.',
    fields: [{ name: 'confirm', label: `برای تأیید، نام فضای کاری («${s.workspace.name}») را بنویسید`, required: true }],
    submitLabel: 'حذف برای همیشه',
    onSubmit: async (v) => { await api('DELETE', '/api/app/settings/workspace', { confirm: v.confirm }); },
  }).then((ok) => ok && location.assign('/panel')));
  const danger = el('section', { class: 'card card-pad cfg-section danger-zone' }, el('h2', { text: 'منطقهٔ خطر' }),
    el('p', { class: 'subtle small', text: 'حذف فضای کاری برگشت‌پذیر نیست. اگر فقط می‌خواهید یک فروشگاه را متوقف کنید، از بخش فروشگاه‌ها «قطع اتصال» را بزنید.' }),
    el('div', { class: 'page-actions' }, remove));

  main.replaceChildren(pageHead('تنظیمات', 'حساب، امنیت و فضای کاری'), el('div', { class: 'int-grid' }, profile, password, workspace, theme, danger));
}
