import type { RegisterEntry } from '../lib/registerEntriesService';

const TYPE_STYLES: Record<RegisterEntry['entry_type'], string> = {
  bill: 'bg-blue-50 text-blue-700',
  payment: 'bg-green-50 text-green-700',
  expense: 'bg-amber-50 text-amber-700',
  deposit: 'bg-purple-50 text-purple-700',
  return: 'bg-red-50 text-red-700',
  credit_refund: 'bg-orange-50 text-orange-700',
  credit_received: 'bg-teal-50 text-teal-700',
};

export default function EntriesTable({ entries }: { entries: RegisterEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">No entries.</p>;
  }
  return (
    <div className="border border-slate-200 rounded-lg overflow-auto max-h-96">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-slate-100 text-slate-600 text-left">
          <tr>
            <th className="px-3 py-2 font-medium border-b border-slate-200">Time</th>
            <th className="px-3 py-2 font-medium border-b border-slate-200">Type</th>
            <th className="px-3 py-2 font-medium border-b border-slate-200">Description</th>
            <th className="px-3 py-2 font-medium border-b border-slate-200 text-right">Amount</th>
            <th className="px-3 py-2 font-medium border-b border-slate-200">Added by</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => (
            <tr key={`${e.entry_type}-${e.created_at}-${i}`} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
              <td className="px-3 py-2 border-b border-slate-100 whitespace-nowrap text-slate-600">
                {new Date(e.created_at).toLocaleTimeString()}
              </td>
              <td className="px-3 py-2 border-b border-slate-100">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[e.entry_type]}`}>
                  {e.entry_type}
                </span>
              </td>
              <td className="px-3 py-2 border-b border-slate-100 text-slate-700">{e.description}</td>
              <td
                className={`px-3 py-2 border-b border-slate-100 text-right font-medium ${
                  e.amount < 0 ? 'text-red-600' : 'text-slate-800'
                }`}
              >
                {e.amount < 0 ? '-' : ''}₹{Math.abs(e.amount).toFixed(2)}
              </td>
              <td className="px-3 py-2 border-b border-slate-100 text-slate-600">{e.created_by_name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
