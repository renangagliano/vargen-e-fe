export const metadata = { title: "Publicações · Admin" };

export default function AdminPublicationsPage() {
  return <section className="admin-gate page-content"><div className="container admin-gate__card"><p className="eyebrow">Admin · Publicações</p><h1>Publicações</h1><p className="admin-lead">O histórico será somente leitura nesta superfície. Qualquer publicação continuará no pipeline controlado e com confirmação explícita.</p><div className="admin-setup-note"><strong>Backend autenticado pendente</strong><span>Nenhuma chamada Meta é feita pelo shell estático.</span></div></div></section>;
}
