// Dialog forms: visible labels, hints, inline error, focus on the first invalid field, Esc cancels.
// onSubmit(values) may throw; its message is shown inside the form and the dialog stays open.

const latinDigits = (text) => String(text).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

/** "۴٬۹۰۰٬۰۰۰" / "4,900,000" -> 4900000, or NaN. */
export function parseAmount(text) {
  const cleaned = latinDigits(text).replace(/[,٬،\s]/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

function control(field, value) {
  const id = `f-${field.name}`;
  const common = { id, name: field.name, required: field.required || null, 'aria-describedby': field.hint ? `${id}-hint` : null };
  if (field.type === 'textarea') return el('textarea', { ...common, class: 'textarea', rows: field.rows ?? 4, maxlength: field.maxlength ?? null, value: value ?? '' });
  if (field.type === 'select') {
    return el('select', { ...common, class: 'select' }, ...field.options.map((o) => el('option', { value: String(o.value), text: o.label, selected: String(o.value) === String(value ?? '') })));
  }
  if (field.type === 'checkbox') return el('input', { ...common, type: 'checkbox', checked: value !== false, class: 'checkbox' });
  if (field.type === 'amount') return el('input', { ...common, class: 'input ltr', inputmode: 'numeric', autocomplete: 'off', value: value === undefined || value === null ? '' : String(value) });
  return el('input', { ...common, class: `input${field.ltr ? ' ltr' : ''}`, type: field.type ?? 'text', maxlength: field.maxlength ?? null, minlength: field.minlength ?? null, pattern: field.pattern ?? null, placeholder: field.placeholder ?? null, autocomplete: 'off', value: value ?? '' });
}

/**
 * @param {{ title: string, intro?: string, fields: object[], initial?: object, submitLabel: string, danger?: boolean,
 *           onSubmit: (values: object) => Promise<void>, extra?: Node }} options
 * @returns {Promise<boolean>} true when submitted successfully, false when cancelled
 */
export function formDialog({ title, intro, fields, initial = {}, submitLabel, danger = false, onSubmit, extra }) {
  return new Promise((resolve) => {
    const error = el('p', { class: 'form-error', role: 'alert' });
    const rows = fields.map((field) => {
      const input = control(field, initial[field.name]);
      if (field.type === 'checkbox') {
        return el('label', { class: 'check-row' }, input, el('span', { text: field.label }));
      }
      return el('div', { class: 'field' }, el('label', { for: input.id, text: field.label + (field.required ? ' *' : '') }), input,
        field.hint ? el('span', { class: 'hint', id: `${input.id}-hint`, text: field.hint }) : null);
    });
    const cancel = el('button', { type: 'button', class: 'btn btn-secondary', text: 'انصراف' });
    const submit = el('button', { type: 'submit', class: `btn${danger ? ' btn-danger-solid' : ''}`, text: submitLabel });
    const form = el('form', { class: 'dialog-form', novalidate: true },
      el('div', { class: 'dialog-body stack' }, el('h2', { id: 'form-title', text: title }), intro ? el('p', { class: 'muted', text: intro }) : null, ...rows, extra ?? null, error),
      el('div', { class: 'form-actions' }, cancel, submit));
    const dialog = el('dialog', { 'aria-labelledby': 'form-title', class: 'form-dialog' }, form);
    const close = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener('click', () => close(false));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    form.addEventListener('input', (e) => e.target.removeAttribute?.('aria-invalid'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const invalid = [...form.elements].filter((f) => f.willValidate && !f.checkValidity());
      for (const f of form.elements) if (f.willValidate) f.setAttribute('aria-invalid', String(invalid.includes(f)));
      if (invalid.length) { error.textContent = invalid[0].validationMessage; invalid[0].focus(); return; }
      const values = {};
      for (const field of fields) {
        const input = form.elements[field.name];
        values[field.name] = field.type === 'checkbox' ? input.checked : field.type === 'amount' ? parseAmount(input.value) : input.value.trim();
        if (field.type === 'amount' && Number.isNaN(values[field.name])) {
          input.setAttribute('aria-invalid', 'true');
          error.textContent = `«${field.label}» باید عدد باشد (مثلاً ۴۹۰۰۰۰۰)`;
          input.focus();
          return;
        }
      }
      await withBusy(submit, async () => {
        try {
          await onSubmit(values);
          close(true);
        } catch (err) {
          error.textContent = err.message;
        }
      });
    });
    document.body.append(dialog);
    dialog.showModal();
    form.querySelector('input, textarea, select')?.focus();
  });
}
