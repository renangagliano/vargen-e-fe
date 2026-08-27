export const metadata = { title: "Analytics · Admin" };

export default function AdminAnalyticsPage() {
  return <section className="admin-gate page-content"><div className="container admin-gate__card"><p className="eyebrow">Admin · Analytics</p><h1>Analytics</h1><p className="admin-lead">A página remota exibirá snapshots persistidos do Instagram sem transformar métricas ausentes em zero.</p><div className="admin-setup-note"><strong>Backend autenticado pendente</strong><span>Os dados serão carregados por uma rota server-side com autorização e estados AVAILABLE, UNSUPPORTED e NOT_AVAILABLE.</span></div></div></section>;
}
