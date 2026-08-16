import { useEffect, useState, useCallback } from 'react';
import { api, formatCurrency } from '../../utils/api';
import { useSocket } from '../../hooks/useSocket';
import { MdAdd, MdPerson, MdCreditCard, MdPayment, MdHistory } from 'react-icons/md';
import Modal from '../../components/Modal';
import toast from 'react-hot-toast';

export default function Creditos() {
  const [creditos, setCreditos] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [form, setForm] = useState({ client: '', phone: '', total: '', items: '' });

  const load = useCallback(async () => {
    try {
      const rows = await api.get('/admin-modules/credits');
      setCreditos(rows || []);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useSocket('staff-data-update', (p) => {
    if (p?.domain === 'credits') void load();
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin-modules/credits', {
        client_name: form.client,
        phone: form.phone,
        total: parseFloat(form.total),
        items: form.items,
      });
      setShowModal(false);
      setForm({ client: '', phone: '', total: '', items: '' });
      toast.success('Crédito registrado');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handlePay = async () => {
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) return toast.error('Monto inválido');
    try {
      await api.post(`/admin-modules/credits/${showPayModal.id}/payments`, { amount });
      setShowPayModal(null);
      setPayAmount('');
      toast.success('Abono registrado');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const totalDeuda = creditos.reduce((s, c) => s + (Number(c.total || 0) - Number(c.paid || 0)), 0);
  const totalCobrado = creditos.reduce((s, c) => s + Number(c.paid || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold rf-page-title rf-module-page-title">Créditos</h1>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2"><MdAdd /> Nuevo Crédito</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="card"><p className="text-xs ui-text-muted">Deuda Total</p><p className="text-xl font-bold text-red-600">{formatCurrency(totalDeuda)}</p></div>
        <div className="card"><p className="text-xs ui-text-muted">Total Cobrado</p><p className="text-xl font-bold text-emerald-600">{formatCurrency(totalCobrado)}</p></div>
        <div className="card"><p className="text-xs ui-text-muted">Clientes con crédito</p><p className="text-xl font-bold">{creditos.filter(c => c.paid < c.total).length}</p></div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="space-y-3">
          {creditos.map(c => {
            const debt = Number(c.total || 0) - Number(c.paid || 0);
            const pct = Number(c.total || 0) > 0 ? (Number(c.paid || 0) / Number(c.total || 0)) * 100 : 0;
            return (
              <div key={c.id} className="p-4 rounded-lg border border-slate-100 hover:bg-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center"><span className="font-bold text-sky-700">{(c.client_name || '?')[0]}</span></div>
                    <div><p className="font-bold">{c.client_name}</p><p className="text-xs ui-text-muted">{c.phone} · {(c.created_at || '').slice(0, 10)}</p></div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">{formatCurrency(c.total)}</p>
                    <p className={`text-xs font-medium ${debt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{debt > 0 ? `Debe: ${formatCurrency(debt)}` : 'Pagado'}</p>
                  </div>
                </div>
                <p className="text-xs text-[var(--ui-muted)] mb-2">{c.items}</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 bg-slate-200 rounded-full h-2"><div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
                  <span className="text-xs ui-text-muted">{pct.toFixed(0)}%</span>
                  {debt > 0 && <button onClick={() => { setShowPayModal(c); setPayAmount(''); }} className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 flex items-center gap-1"><MdPayment /> Abonar</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Nuevo Crédito" size="md">
        <form onSubmit={handleCreate} className="space-y-4">
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Cliente</label><input value={form.client} onChange={e => setForm({ ...form, client: e.target.value })} className="input-field" required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Teléfono</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto Total</label><input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} className="input-field" required /></div>
          </div>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Detalle de consumo</label><textarea value={form.items} onChange={e => setForm({ ...form, items: e.target.value })} className="input-field" rows="2" /></div>
          <div className="flex gap-3"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button type="submit" className="btn-primary flex-1">Registrar</button></div>
        </form>
      </Modal>

      <Modal isOpen={!!showPayModal} onClose={() => setShowPayModal(null)} title={`Abonar - ${showPayModal?.client_name || ''}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm ui-text-muted">Deuda actual: <span className="font-bold text-red-600">{formatCurrency((showPayModal?.total || 0) - (showPayModal?.paid || 0))}</span></p>
          <div><label className="block text-sm font-medium text-[var(--ui-body-text)] mb-1">Monto a abonar</label><input type="number" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="input-field" placeholder="0.00" autoFocus /></div>
          <div className="flex gap-3"><button onClick={() => setShowPayModal(null)} className="btn-secondary flex-1">Cancelar</button><button onClick={handlePay} className="btn-primary flex-1">Registrar Abono</button></div>
        </div>
      </Modal>
    </div>
  );
}
