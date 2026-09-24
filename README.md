# Juris Notes (1.0.2) — Assistente de Mapeamento Estruturado para Elaboração de Acórdãos

## Evolução do Ecossistema (Nota de Implantação)
O Juris Notes foi concebido inicialmente focado no painel de Recursos Ordinários (RO), visando estruturar a análise de mérito e provas[cite: 1]. Atualmente, a ferramenta encontra-se em fase de expansão e implantação de novos silos funcionais isolados, incorporando os ecossistemas dedicados aos Embargos de Declaração (ED) e ao Agravo de Instrumento (AI), garantindo que cada incidente processual possua seu próprio viés cognitivo e roteiro de análise focado em fluxos específicos da jurisdição trabalhista[cite: 1, 2].

## 1. Contexto do Domínio e o Desafio Cognitivo
Esta aplicação foi desenvolvida para revolucionar o trabalho de assistentes judiciais de gabinete em tribunais de segunda instância[cite: 1]. O Juris Notes atua como a ponte ideal entre a leitura humana do Inteiro Teor e a redação da minuta com auxílio de Inteligência Artificial[cite: 1].

### O Desafio da IA e o "Efeito Túnel" Humano
Fazer o upload de um processo em PDF de milhares de páginas diretamente para uma IA gera perda de contexto e invenção de fatos (alucinações)[cite: 1]. A IA precisa do recorte exato dos fatos, focado exclusivamente no Efeito Devolutivo (os tópicos que efetivamente foram objeto de recurso)[cite: 1].

Por outro lado, o assessor humano muitas vezes sofre do "efeito túnel": devido ao volume de trabalho, é comum ler o Recurso e saltar diretamente para a Sentença, perdendo a dimensão exata do conflito original (A Inicial e a Contestação) ou negligenciando a revaloração minuciosa das Provas[cite: 1].

### A Solução: O Guia Metodológico Silencioso
O Juris Notes age como um "Fichário Inteligente" que inverte a lógica: o assessor humano faz a curadoria das provas guiado por uma interface que o educa visualmente, e a IA atua apenas na redação final[cite: 1]. O aplicativo não proíbe saltos ou impõe travas burocráticas, mas utiliza cores, organização espacial e alertas sutis para incentivar uma análise cronológica e completa da lide, garantindo uma minuta blindada[cite: 1]. Com a adoção contínua de princípios de Visual Law e Linguagem Simples, o sistema assegura clareza e acessibilidade na formulação do raciocínio jurídico, otimizando o fluxo de retenção cognitiva através do agrupamento inteligente (chunking).

## 2. A Metodologia das 4 Fases e Zonas Visuais (Fluxo Padrão - Recurso Ordinário)
Para combater a carga cognitiva e organizar o raciocínio jurídico, o sistema divide a extração em 4 Fases Metodológicas Essenciais[cite: 1]. Cada fase possui um propósito lógico e uma identidade visual (cor)[cite: 1]:

### 🟦 FASE 1: O Recurso (O Filtro) — Cor: Azul
* Propósito: Delimitar a fronteira da atuação do Tribunal (Efeito Devolutivo)[cite: 1]. Identificamos exatamente do que a parte reclama[cite: 1].
* Peças Típicas: Recurso Ordinário, Recurso Adesivo, Contrarrazões[cite: 1].
* Impacto Visual: Sempre ordenados no topo do painel[cite: 1]. É a lente através da qual o resto do processo será lido[cite: 1].

### 🟩 FASE 2: A Gênese (A Origem) — Cor: Verde
* Propósito: Compreender como a lide nasceu[cite: 1]. Impede surpresas por inovações recursais ou argumentos não levantados na contestação[cite: 1].
* Peças Típicas: Petição Inicial, Contestação, Impugnação à Contestação[cite: 1].

### 🟪 FASE 3: O Julgamento (A Sentença) — Cor: Roxo
* Propósito: Analisar o que o Juízo de 1º grau decidiu e quais foram os fundamentos adotados[cite: 1].
* Peças Típicas: Sentença[cite: 1].

### 🟧 FASE 4: A Validação (As Provas) — Cor: Laranja
* Propósito: É o acervo probatório bruto[cite: 1]. Onde a verdade real é confrontada com as alegações[cite: 1].
* Peças Típicas: Prova Documental Genérica, Laudos Periciais, Oitivas de Audiência (Áudio/Transcrição)[cite: 1].

### O Dashboard de Maturidade (Termômetro de Teses - RO)
No fluxo padrão, cada tese possui uma barra de progresso em "vidro fosco"[cite: 1]. Se a tese agrupa elementos de todas as fases metodológicas essenciais (ex: Recurso + Sentença + Provas), o card se preenche de cores e atinge sua maturidade máxima, ganhando um efeito de estrela giratória (sinalizando que está segura para exportação)[cite: 1].

## 3. Mudança de Paradigma: Arquitetura em Hub e Ecossistemas Isolados
Com a maturação da ferramenta, percebeu-se que diferentes incidentes processuais exigem "vieses cognitivos" completamente diferentes por parte do assessor[cite: 1]. O fluxo de um Recurso Ordinário (RO) não atende à dinâmica restrita dos Embargos de Declaração (ED)[cite: 1] ou à natureza processual do Agravo de Instrumento (AI)[cite: 2].

Para acomodar isso de forma segura, o Juris Notes adotou uma Arquitetura em Hub (Estado de Transição)[cite: 1]:
* O Hub de Entrada (`/`): Uma tela inicial de Onboarding onde o usuário declara a natureza da sua análise (Recurso Ordinário, Embargos de Declaração ou Agravo de Instrumento) antes de carregar o processo[cite: 1, 2].
* Silos Funcionais Isolados (`/ro`, `/ed` e `/ai`): A aplicação foi dividida em diretórios independentes[cite: 1]. Cada ambiente recebe adaptações cirúrgicas exclusivas (poda de ferramentas de mérito e novas intenções de IA)[cite: 1]. Essa separação garante que possamos inovar nos fluxos secundários sem risco de quebrar ou engessar o sistema maduro do RO[cite: 1].
* Ecossistemas de Backup Próprios: Cada painel gera e lê seu próprio arquivo `.json` de backup e possui sua própria estrutura de formatação para IA, evitando contaminação de dados entre incidentes processuais distintos[cite: 1].

## 4. Metodologia Adaptada: O Incidente de Embargos de Declaração (ED)
Quando o sistema entra no "Modo ED", as 4 cores são mantidas, mas a cognição por trás delas sofre uma mutação para atuar como uma Lente de Auditoria Estrita[cite: 1]. Em ED, não se discute a justiça da decisão, mas sim a sua higidez estrutural[cite: 1].

### 🟦 FASE 1: A Lente de Auditoria (O Escopo do Vício) — Cor: Azul
* Propósito: Delimitar estritamente qual é a falha estrutural alegada (Omissão, Contradição ou Erro Material)[cite: 1].
* A "Mágica" Cognitiva: O card Azul atua como uma viseira para o assessor[cite: 1]. Qualquer argumento subsequente que tente rediscutir a justiça da decisão (fuga de escopo) será mentalmente barrado, pois não responde ao recorte Azul[cite: 1].

### 🟩 FASE 2: O Limite da Provocação (A Gênese) — Cor: Verde
* Propósito: Confirmar o prequestionamento ou a provocação original[cite: 1]. O juízo não pode ser omisso sobre algo que nunca lhe foi pedido (Recortes da Inicial, Contestação ou RO originário)[cite: 1].
* A "Mágica" Cognitiva: Se o assessor não encontrar nada para colorir de Verde, a tese cai por inovação recursal[cite: 1]. A prova visual da inovação é a própria ausência da cor Verde[cite: 1].
* O Paradigma do Áudio em Omissões: Diferente do fluxo de RO, no painel de ED, extrações de Áudio (MP3) são forçadas para a Fase 2 (Verde)[cite: 1]. O objetivo não é reavaliar o que a testemunha disse, mas apenas provar que o depoimento ocorreu e foi ignorado pelo juiz[cite: 1]. Como "Guardrail" para a Inteligência Artificial, as degravações literais de áudio são bloqueadas no momento da exportação, impedindo que a IA alucine e tente rejulgar os fatos[cite: 1].

### 🟪 FASE 3: O Alvo da Crítica (A Decisão Embargada) — Cor: Roxo
* Propósito: Isolar a fundamentação sob ataque para auditar se o vício apontado no recorte Azul realmente existe (Acórdão ou Sentença embargada)[cite: 1].
* A "Mágica" Cognitiva (A Dinâmica da Contradição): Se a Fase 1 (Azul) alegou Contradição, o assessor é forçado a extrair dois recortes Roxos conflitantes da decisão[cite: 1]. O visual de um card Roxo brigando com outro card Roxo evidencia que a contradição é interna[cite: 1]. Contradição com a prova (Roxo vs. Laranja) é denunciada visualmente como incabível[cite: 1].

### 🟧 FASE 4: A Prova Material do Vício (Validação Restrita) — Cor: Laranja
* Propósito: Comprovar documentalmente apenas erros materiais evidentes (ex: data trocada) ou ignorância de jurisprudência vinculante[cite: 1].
* A "Mágica" Cognitiva (O Guardrail Ativo): O catálogo de documentos da Fase 4 em ED foi podado (Laudos e Audiências foram removidos)[cite: 1]. Além disso, um Middleware Client-Side monitora a extração[cite: 1]. Se o assessor extrair múltiplos documentos fáticos (Laranja), o sistema emite um alerta bloqueando a carga cognitiva errada: "Atenção: Cuidado para não reavaliar os fatos. Em Embargos, limite-se a falhas estruturais."[cite: 1].

### Dashboard de Maturidade Inteligente (ED)
O sistema exige que o assessor defina tipologicamente o vício logo na criação do tópico (Omissão, Contradição ou Erro Material)[cite: 1]. A partir dessa tipagem (Single Source of Truth), a estrela de 100% de maturidade obedece a fórmulas lógicas exclusivas, sem exigir preenchimento inútil de fases[cite: 1]:
* Omissão: Maturidade = Azul + Verde + Roxo (A prova Laranja é dispensável)[cite: 1].
* Contradição: Maturidade = Azul + Roxo + Roxo (Confronto de duas premissas do próprio juiz. Não usa Verde nem Laranja)[cite: 1].
* Erro Material: Maturidade = Azul + Roxo + Laranja (Evidência documental cirúrgica do erro)[cite: 1].

### Mudança de Semântica Cognitiva (Nós de Ideia)
No ecossistema de ED, os rótulos de instrução da IA sofreram mutação[cite: 1]. A intenção de "Refutação (Mérito)" — comum em Recursos Ordinários — foi substituída por "Confirmação de Higidez"[cite: 1]. Isso orienta a máquina a não debater a justiça da decisão, mas sim redigir parágrafos demonstrando que a sentença embargada já era clara, completa e isenta de vícios[cite: 1].

## 5. Metodologia Adaptada: O Incidente de Agravo de Instrumento (AI)
Assim como os Embargos de Declaração exigem uma mudança de postura, o módulo de Agravo de Instrumento (AI) introduz um viés cognitivo totalmente voltado para a Auditoria de Admissibilidade[cite: 2]. Neste ecossistema isolado, o mérito da causa original fica em segundo plano; a discussão central é destravar (ou manter trancado) o recurso principal que teve seu seguimento denegado.

O painel adota a identidade visual Verde-Limão e foca estritamente em óbices de trânsito: tempestividade, preparo (custas e depósito recursal) e representação processual[cite: 2].

As 4 Zonas Visuais sofrem uma nova mutação para guiar o olhar do assessor de forma cirúrgica:

### 🟦 FASE 1: O Escopo do Destravamento (O Agravo) — Cor: Azul
* Propósito: Identificar qual é o argumento da parte para tentar destrancar o recurso.
* A "Mágica" Cognitiva: O card Azul atua como o delimitador do inconformismo contra o trancamento. O assessor deve extrair apenas as justificativas sobre o porquê o recurso originário deveria ter sido aceito. Argumentos de mérito (ex: horas extras, insalubridade) trazidos no Agravo devem ser sumariamente ignorados nesta fase, blindando a minuta contra análises precoces de mérito.

### 🟩 FASE 2: O Alvo do Trancamento (O Recurso Originário) — Cor: Verde
* Propósito: Registrar o recurso que se encontra trancado (ex: o Recurso Ordinário ou Agravo de Petição denegado).
* A "Mágica" Cognitiva: Serve para comprovar visualmente o que está em jogo. Não se analisa o conteúdo profundo desta peça, mas apenas a sua existência e as datas/assinaturas que a compõem.

### 🟪 FASE 3: O Óbice (O Despacho Denegatório) — Cor: Roxo
* Propósito: Isolar o fundamento exato utilizado pelo juízo *a quo* para barrar o recurso (ex: "recurso deserto por ausência de recolhimento de custas").
* A "Mágica" Cognitiva: Ao confrontar o Azul (Agravo) com o Roxo (Despacho Denegatório), a controvérsia processual se ilumina. O sistema força o usuário a enxergar se o agravante realmente atacou os fundamentos do despacho ou se trouxe justificativas genéricas.

### 🟧 FASE 4: A Prova de Admissibilidade (Validação Documental) — Cor: Laranja
* Propósito: Comprovação material dos pressupostos extrínsecos.
* A "Mágica" Cognitiva (O Guardrail Ativo): Neste módulo, laudos periciais e depoimentos são irrelevantes. A Fase Laranja é estritamente reservada para extrações de Guias de Recolhimento (GRU/GFIP), Comprovantes de Pagamento, Procurações, Substabelecimentos e Certidões de Intimação. O foco é a matemática dos prazos e a validade financeira/representativa.

### Dashboard de Maturidade Inteligente (AI)
No ambiente do Agravo de Instrumento, a "estrela de maturidade" foca na tríade da admissibilidade. Para um tópico de trancamento ser considerado maduro para exportação para a IA, ele tipicamente exigirá:
* Maturidade de Preparo/Tempestividade: Azul (A alegação do Agravante) + Roxo (O Despacho que trancou) + Laranja (O comprovante de pagamento ou certidão de prazo que prova quem tem razão).

### Mudança de Semântica Cognitiva (Nós de Ideia)
A intenção enviada ao LLM abandona o campo do mérito e da higidez da sentença, focando em comandos como "Análise de Pressupostos Extrínsecos" ou "Validação de Preparo/Tempestividade", instruindo a inteligência artificial a redigir exclusivamente sobre a superação (ou manutenção) do obstáculo processual.

## 6. Arquitetura Geral da Aplicação
Aplicação Client-Side Only (sem backend)[cite: 1]. Toda a lógica de leitura, extração e salvamento roda inteiramente no navegador do usuário, garantindo Sigilo Judicial Absoluto (os dados do processo nunca vão para um servidor na nuvem sem o consentimento do usuário via botão de exportação manual)[cite: 1]. 

Para manter o foco no fluxo de trabalho e evitar distrações, a interface adota uma identidade visual institucional limpa, descartando elementos visuais como contadores de versão, históricos técnicos ou paletas de cores escuras/douradas supérfluas.

> ⚠️ Restrição Crítica: A aplicação usa a File System Access API (para backup transparente local)[cite: 1]. Funciona exclusivamente em navegadores baseados em Chromium (Google Chrome 86+, Microsoft Edge 86+, Opera)[cite: 1]. Não suportado no Firefox e Safari[cite: 1].

> 🛡️ Gestão de Mídia Local: Para manter a leveza do arquivo de backup (`.json`) e garantir o sigilo, os PDFs e arquivos de áudio (`.mp3`) não são embutidos dentro dele[cite: 1]. O sistema salva apenas as coordenadas geométricas e temporais via Hashes[cite: 1]. Ao retomar uma sessão, o usuário precisa apontar novamente para os arquivos originais em sua máquina[cite: 1].

## 7. Funcionalidades e Evolução do Projeto

### v1.0 a v3.0 — Fundação e Extração
- Carregamento assíncrono de PDFs via PDF.js com renderização lazy load[cite: 1].
- Recorte de imagens, textos e mapeamento de audiências em MP3[cite: 1]. Para assegurar a precisão no manuseio de provas orais, o sistema dá prioridade a funções que transcrevem diretamente o áudio com alta exatidão, superando edições focadas em polimento estilístico.
- Integração LLM (Exportação em Markdown) e Validação Anti-Corrupção SHA-256[cite: 1].

### v4.0 — Ergonomia e Nós de Ideia
- Fundo de leitura confortável (Jasmine e Branco)[cite: 1].
- Separação entre a Prova Bruta (Main Card) e a Conclusão do Assessor (Nós de Ideia/Sub-anotações)[cite: 1].

### v5.0 — Inteligência Metodológica e Zonas Visuais
- Modal de Extração por Mini-Abas: Categorização das peças nas 4 fases diretamente no momento do recorte[cite: 1].
- Smart Sort (Reordenação Inteligente): O sistema realoca o card automaticamente para a Zona (Fase) correta, independentemente da ordem em que o assessor lê o PDF[cite: 1].
- Dashboard de Maturidade Padrão: Indicador de completude de teses no RO[cite: 1].

### v6.0 — Arquitetura Hub, Modo ED e Integração de Gabinete (Atual)
- Hub e Silos Separados: Divisão entre o ambiente Padrão (RO), o ambiente restrito para Embargos de Declaração (ED) e o ambiente para Agravo de Instrumento (AI)[cite: 1, 2].
- Arquitetura "Roteiro do Diretor": O arquivo exportado funciona como um payload cognitivo estruturado, entregando o "esqueleto" (matriz dialética) para o LLM via tags XML[cite: 1].
- Fila de Download Sequencial Segura: Download de imagens-prova via fila assíncrona encadeada[cite: 1].

## 8. Guia de Uso Rápido

### Iniciando a Extração
1. Escolha a natureza do incidente (RO, ED ou AI) no Hub de Entrada[cite: 1, 2].
2. Clique em Novo Processo e carregue o PDF[cite: 1].
3. Salve o arquivo de backup `.json` (ele atualizará sozinho a cada ação)[cite: 1].
4. Crie as abas dos tópicos recursais (ou vícios alegados / itens de trancamento)[cite: 1].
5. Selecione textos, recorte imagens ou áudios e classifique a fase correspondente no modal[cite: 1].

### Retomando um Processo em Andamento (Backup)
1. Escolha o módulo correto (RO, ED ou AI)[cite: 1, 2].
2. Clique em Retomar Processo e selecione o arquivo `.json`[cite: 1].
3. Carregue o arquivo PDF correspondente (validado via Hash SHA-256)[cite: 1].
4. Reconectando Áudios (MP3): Clique no ícone de microfone laranja pulsante para reanexar os áudios locais por questões de segurança do navegador[cite: 1].

### Desenvolvendo a Tese e Exportando para a IA
1. Extraia e agrupe os recortes sob as teses criadas[cite: 1]. Observe o Dashboard de Maturidade sinalizar o progresso ou apontar falhas cognitivas[cite: 1].
2. Nos Nós de Ideia, classifique a intenção processual (Premissa, Fundamentação, Validação de Preparo, etc.)[cite: 1].
3. Clique em Exportar (Seta para Cima) para gerar o pacote (`.md` estruturado + imagens)[cite: 1].
4. No modelo de IA de sua escolha, faça o upload do Pacote, dos PDFs e das imagens em conjunto[cite: 1].

## 9. Estrutura de Arquivos do Repositório (Por Silo)
Cada diretório (`/ro`, `/ed` e `/ai`) possui sua própria estrutura modular espelhada, garantindo isolamento[cite: 1]. O código se mantém fiel ao padrão Inline Script já adotado em seu projeto, prescindindo da chamada de arquivos externos genéricos que poderiam quebrar o escopo de cada silo individual.

| Arquivo | Responsabilidade |
|---------|------------------|
| `index.html` | Estrutura semântica, importação de dependências e modais[cite: 1]. |
| `juris-core.css` | Variáveis globais, Z-Index, paletas e estrutura base responsiva[cite: 1]. |
| `juris-workspace.css` | Sistema das Zonas Visuais (Cores), Dashboard e UI do PDF[cite: 1]. |
| `app.js` | Orquestrador global, Smart Sort e motor heurístico[cite: 1]. |
| `topics-manager.js` | Renderização do fichário, painel de teses (maturidade)[cite: 1]. |
| `backup-manager.js` | Persistência local (API File System) e Hashes Criptográficos[cite: 1]. |
| `export-manager.js` | Geração do payload estruturado e injeção de tags XML para o LLM[cite: 1]. |
| `audio-manager.js` | Controle de playback, reconexão de MP3 e marcações[cite: 1]. |
| `interaction-tools.js`| Wizards de captura, configuração das fases (DOC_CONFIG) e modais[cite: 1]. |
| `annotation-actions.js`| CRUD de anotações e reordenação manual de cards[cite: 1]. |
