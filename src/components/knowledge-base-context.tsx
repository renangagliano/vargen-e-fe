import type { KnowledgeBaseSong } from "@/data/knowledge-base";

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function ContextBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="knowledge-base__block"><p className="knowledge-base__label">{label}</p><div className="knowledge-base__value">{children}</div></div>;
}

export function KnowledgeBaseContext({ entry }: { entry?: KnowledgeBaseSong }) {
  if (!entry) return null;

  const coreMessage = clean(entry.core_message);
  const story = clean(entry.biblical_story);
  const liturgicalContext = clean(entry.liturgical_context);
  const calendarContext = clean(entry.calendar_context);
  const historicalContext = clean(entry.historical_context);
  const bibleReferences = uniqueValues([entry.primary_bible_reference, ...entry.secondary_bible_references]);
  const themes = uniqueValues([entry.primary_theme, ...entry.secondary_themes]);
  const characters = uniqueValues(entry.biblical_characters);
  const showCalendar = calendarContext && calendarContext !== liturgicalContext ? calendarContext : null;

  const hasContext = Boolean(coreMessage || story || liturgicalContext || showCalendar || historicalContext || bibleReferences.length || themes.length || characters.length);
  if (!hasContext) return null;

  return <section className="knowledge-base" aria-labelledby="knowledge-base-title">
    <div className="knowledge-base__heading">
      <p className="eyebrow">Contexto da canção</p>
      <h2 id="knowledge-base-title">A Palavra por trás da música</h2>
      <p>Uma leitura editorial para acompanhar a escuta com mais profundidade.</p>
    </div>
    <div className="knowledge-base__grid">
      {coreMessage && <ContextBlock label="Mensagem central"><p>{coreMessage}</p></ContextBlock>}
      {bibleReferences.length > 0 && <ContextBlock label="Referência bíblica"><ul className="knowledge-base__tags">{bibleReferences.map((reference) => <li key={reference}>{reference}</li>)}</ul></ContextBlock>}
      {story && <ContextBlock label="Contexto bíblico"><p>{story}</p></ContextBlock>}
      {themes.length > 0 && <ContextBlock label="Temas"><ul className="knowledge-base__tags">{themes.map((theme) => <li key={theme}>{theme}</li>)}</ul></ContextBlock>}
      {characters.length > 0 && <ContextBlock label="Personagens"><ul className="knowledge-base__tags">{characters.map((character) => <li key={character}>{character}</li>)}</ul></ContextBlock>}
      {liturgicalContext && <ContextBlock label="Contexto litúrgico"><p>{liturgicalContext}</p></ContextBlock>}
      {showCalendar && <ContextBlock label="Calendário"><p>{showCalendar}</p></ContextBlock>}
      {historicalContext && <ContextBlock label="Contexto adicional"><p>{historicalContext}</p></ContextBlock>}
    </div>
  </section>;
}
