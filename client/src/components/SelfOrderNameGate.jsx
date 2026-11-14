import { useState } from 'react';
import { MdPerson } from 'react-icons/md';

/** Nombre que el QR pide antes de la carta. Solo va a la comanda y a la cuenta. */
export default function SelfOrderNameGate({ subtitle, onContinue }) {
  const [draft, setDraft] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const name = String(draft || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) return;
    onContinue(name);
  };

  return (
    <div className="flex min-h-screen min-h-[100dvh] items-center justify-center bg-[#f3f4f6] p-6 text-[#111827]">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
      >
        <MdPerson className="mx-auto mb-3 text-5xl text-[#f97316]" />
        <h1 className="text-center text-xl font-bold">¿Cómo te llamas?</h1>
        <p className="mt-2 text-center text-sm text-[#6b7280]">
          Tu nombre sale en la comanda y en la cuenta de este pedido.
        </p>
        {subtitle ? (
          <p className="mt-1 text-center text-xs font-semibold text-[#111827]">{subtitle}</p>
        ) : null}
        <input
          type="text"
          autoFocus
          required
          maxLength={40}
          autoComplete="name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escribe tu nombre"
          className="mt-5 w-full rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-base outline-none focus:border-[#f97316]"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-full bg-[#f97316] py-3 text-sm font-bold text-white"
        >
          Continuar
        </button>
      </form>
    </div>
  );
}
