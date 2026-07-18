# Ruínas do Véu Azul — fase PS2 / AthenaEnv

Protótipo jogável de uma arena glacial inspirado nas duas imagens de referência. A fase é totalmente 3D e foi desenhada para o orçamento do PlayStation 2: uma malha estática combinada, iluminação azul e laranja gravada nos vértices e poucas chamadas de desenho.

## Controles

- Analógico esquerdo ou direcional: andar
- Analógico direito: girar a câmera sobre o ombro
- X: correr
- Quadrado: pular
- L1: trocar o ombro da câmera
- R3: alinhar a câmera atrás do personagem
- Select: voltar ao ponto inicial
- Start: mostrar/ocultar a interface

O personagem provisório é o cubo claro. A colisão impede cair nos abismos, atravessar os cristais centrais e sair da área jogável. O movimento desliza ao longo dos obstáculos e das bordas.

## Executar

No Windows, gere o pacote isolado e execute-o no PCSX2:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run-pcsx2.ps1
```

Na primeira execução, o launcher cria uma cópia portátil ignorada pelo Git em `build/pcsx2-portable`. Assim, configurações, BIOS, cartões de memória e caches usados nos testes ficam isolados em uma área gravável do workspace.

Para que a janela do emulador seja exibida, inicie o editor por `scripts\editor.ps1` em um PowerShell normal do Windows. Um servidor iniciado por um terminal automatizado sem desktop interativo pode executar o PCSX2 em segundo plano sem conseguir mostrar sua janela; nesse caso, o launcher agora informa o problema em vez de registrar um falso sucesso.

O launcher passa `athena.elf` diretamente como arquivo de boot e define `build/dist` como raiz HostFS. Não usa `-elf`, porque esse parâmetro apenas substitui o executável do disco selecionado e pode reabrir outro jogo. No hardware real, copie todo o conteúdo de `build/dist` para o mesmo diretório no dispositivo usado pelo launcher e inicie `athena.elf`.

O build reutiliza por padrão `build/dist/athena.elf`. Para apontar para outro runtime, use `-AthenaElf <caminho>` ou defina a variável `ATHENA_ELF`; não há mais caminho absoluto dependente da máquina do autor.

## Editor visual

Inicie o editor local no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\editor.ps1
```

Abra `http://127.0.0.1:4173/editor/` no navegador. O editor oferece:

- viewport 3D com câmera orbital, vistas superior, frontal e lateral e gizmo de eixos X/Y/Z clicável;
- Mão temporária em qualquer ferramenta ao segurar o botão direito;
- seleção pela viewport ou hierarquia;
- seleção múltipla com `Ctrl+clique`, seleção por caixa com `B` e transformação por pivô comum ou editável;
- grupos, relações pai/filho, pais expansíveis/recolhíveis, arrastar na hierarquia e preservação da transformação mundial;
- seções dos painéis laterais em acordeão, com o estado do layout preservado no navegador;
- ocultar, bloquear e isolar objetos ou grupos pela hierarquia;
- gizmos de posição, rotação e escala;
- inspector numérico, visibilidade, bloqueio e inclusão no runtime;
- configurações de runtime para fundo, VSync, diagnóstico de FPS/draw calls/triângulos/VRAM, limites da arena e parâmetros completos do jogador;
- primitivas de cubo, esfera, cilindro, cone e plano;
- materiais por objeto com textura efetiva no PS2, cor, opacidade, rugosidade, metal, emissão, face dupla e pipelines iluminado, especular ou sem iluminação;
- reprodução automática de animações de modelos GLTF/GLB, com escolha de clipe e loop;
- luzes ambiente, direcionais e pontuais com gizmos, alcance, flicker e preset de fogueira;
- câmeras de cena com modos seguir, fixa e fixa olhando o jogador, além de preview em 640 × 448;
- colisores visuais de caixa, esfera e cápsula, com trigger e bloqueio de câmera;
- componentes de trigger com eventos de entrada, saída e interação executados no PS2;
- visual scripting por grafos com eventos de início, trigger, botão, pulo real do jogador e temporizador; condições, variáveis globais persistentes na sessão, espera e ações para mensagens, exibição de valores, visibilidade, teleporte, troca de cena, áudio, partículas e vídeo;
- projetores de sombra oficiais com textura, grade, direção da luz, bias, deslocamento, cor, blend e opção de seguir o jogador;
- editor de interface 2D em 640 × 448 com painéis, textos, imagens e vídeos MPEG, arraste e redimensionamento;
- fontes TTF/OTF ou bitmap na UI, medição exata, alinhamento, contorno ou sombra projetada;
- gerenciamento de cenas persistentes, com criação, renomeação, duplicação, exclusão, reordenação, estatísticas, cena inicial independente e exportação do projeto completo;
- carregamento dinâmico de uma única cena no PS2, com portais condicionais, pontos de entrada orientados, fade, estado opcional de objetos e liberação dos recursos da cena anterior;
- fontes de áudio WAV/OGG e efeitos ADPCM com loop, volume, pan, pitch e alcance espacial;
- emissores 3D de fogo, fumaça e faíscas com pool de partículas limitado para o PS2;
- prefabs criados a partir de qualquer seleção, incluindo grupos e colisores;
- importação múltipla de OBJ/MTL, GLTF/GLB, BIN, PNG/BMP/JPEG, TTF/OTF, WAV/OGG/ADP e M2V/MPG/MPEG;
- biblioteca dos modelos disponíveis no projeto;
- duplicação, exclusão, desfazer/refazer e snap por grade, superfície, vértice ou centro de objeto;
- copiar e colar modelos, grupos, primitivas e colisores com a hierarquia preservada;
- salvamento direto para o runtime e botão para testar no PCSX2.

Ao importar OBJ ou GLTF com arquivos externos, selecione também o MTL, BIN e as texturas relacionados. Eles serão copiados juntos para `assets/imported`.

Cada cena fica em `editor/scenes`, enquanto `editor/scene.json` continua como espelho compatível da cena aberta no editor. O botão **Gerenciar cenas** permite criar, renomear, duplicar, excluir e ordenar cenas, além de mostrar quantos objetos, elementos de interface e grafos cada uma possui. Alterações pendentes são salvas antes da navegação para impedir perdas acidentais.

A cena **Inicial** é independente da cena aberta para edição: ela é exportada para `assets/scene.generated.js` e é a que o PS2 carrega ao iniciar. Todas as cenas também recebem uma cópia própria em `assets/scenes`, acompanhadas de `project.generated.js`, que registra nomes, arquivos, pontos de entrada e variáveis globais. **Exportar projeto** baixa um único JSON com o índice e o conteúdo de todas as cenas.

O catálogo e cada cena canônica são gravados com arquivos temporários exclusivos, substituição atômica e filas de escrita por destino. Um lock de projeto com proprietário e heartbeat impede que o build, imports e o servidor alterem cenas ou assets simultaneamente; o build copia um snapshot imutável para um staging exclusivo e rejeita um segundo empacotamento concorrente de `build/dist`. Definir a cena inicial salva primeiro qualquer alteração pendente; se o documento mudar enquanto a requisição estiver em andamento, o editor detecta a nova revisão e envia a versão mais recente em vez de aplicar uma resposta obsoleta. Se o índice estiver ausente, o servidor o reconstrói examinando todos os JSONs canônicos de `editor/scenes`, sem substituir uma cena pelo espelho legado `editor/scene.json`; o build também reincorpora arquivos canônicos órfãos antes de exportar. Arquivos inválidos interrompem a operação com os dados originais preservados, e cenas excluídas são arquivadas em `editor/scenes/.trash` somente depois que o novo catálogo foi confirmado.

Use **Ponto de entrada** para marcar onde e em qual direção o jogador aparece. O primeiro ponto criado vira a entrada padrão da cena, mas qualquer um pode ser escolhido por um portal. **Portal de cena** cria um trigger configurável para trocar ao entrar ou ao pressionar `Triângulo`; seu inspector escolhe cena, entrada, duração do fade e uma condição opcional baseada em variável global. Durante a troca, o runtime conclui o fade, encerra o loop da cena, pausa o áudio e libera dados 3D, texturas, vídeo, partículas e sombras antes de carregar somente o arquivo de destino no mesmo ambiente JavaScript. A coleta do QuickJS não é forçada nesse ponto: apenas as views de matrizes/vetores que o AthenaEnv liga à memória interna de `RenderObject` e modelos esqueléticos permanecem inertes durante a sessão, evitando que seus finalizadores liberem ponteiros emprestados. `Sound.Stream` também permanece em um cache por arquivo: o AthenaEnv mantém o stream atual em um ponteiro nativo usado pelo callback do `audsrv`, mas `sound_free()` não limpa esse ponteiro; liberá-lo entre cenas pode fazer a thread de áudio acessar memória já desalocada. Os shells de objetos, texturas e a memória pesada das malhas continuam sendo liberados. `Render`, `Pad`, fontes, streams e os quatro slots de `Lights` pertencem ao controlador e são reutilizados entre cenas. O menu não é reaberto entre fases.

As variáveis criadas no modo **LOGIC** pertencem ao projeto inteiro. Seus valores são inicializados uma vez e permanecem em memória enquanto o jogo estiver aberto, inclusive depois de descarregar uma cena. Em modelos e primitivas, **Persistir estado** guarda a visibilidade alterada por eventos ou grafos e a restaura quando o jogador retorna à cena. Essa persistência é de sessão; salvar e continuar após desligar o console exigirá um sistema separado de save no memory card.

O modo **Interface** trabalha nas coordenadas nativas de 640 × 448. Painéis usam `Draw.rect`, textos usam `Font`, imagens usam `Image` e vídeos usam `Video`/`Video.frame` no `main.js`. Posição, tamanho, cor, opacidade, conteúdo, alinhamento, fonte e efeitos configurados no editor entram no runtime. Contorno e sombra de texto são mutuamente exclusivos, como exige a documentação oficial. Vídeos podem iniciar automaticamente ou ser controlados por ações de trigger. Arraste um elemento para posicioná-lo e use a alça inferior para redimensionar.

As dimensões dos colisores seguem a visualização do editor: na caixa, `scale` representa as meias-extensões; na esfera e na cápsula, representa os raios locais. Posição, rotação XYZ, escala hierárquica e altura são exportadas em coordenadas mundiais. Triggers são detectados sem bloquear, e **Bloquear câmera** afeta somente a câmera.

Triggers podem executar ações **Ao entrar**, **Ao sair** ou **Ao interagir** com `Triângulo`. As ações mostram mensagens na HUD, mostram/ocultam objetos ou grupos, teletransportam o jogador, trocam de cena e controlam áudio, partículas ou vídeo. Grupos usados como alvo são resolvidos para seus modelos filhos durante a exportação, e todas as ações são executadas pelo `main.js` no PS2.

O modo **LOGIC** amplia esses eventos para grafos visuais reutilizáveis. Um fluxo começa em **Ao iniciar**, **Trigger**, **Botão pressionado**, **Jogador pulou** ou **Temporizador** e segue pelas conexões entre condições, ações, alterações de variável global e esperas em quadros. **Jogador pulou** só dispara quando o personagem realmente inicia um pulo estando no chão. **Mostrar variável** escreve um prefixo e o valor atual na HUD. Condições possuem saídas separadas para **sim** e **não**. O nó terminal **Trocar de cena** escolhe a cena, a entrada e o fade. O botão **Validar** encontra nós desconectados, variáveis ausentes, portais condicionais inválidos, cenas ou entradas inexistentes e ações sem alvo antes da exportação. As ações antigas de um trigger podem ser convertidas para um grafo pelo inspector; a conversão remove a lista antiga para evitar execução duplicada.

Os grafos são dados declarativos, não código arbitrário. O runtime interpreta somente os nós permitidos, limita cada evento a 128 passos e interrompe ciclos acidentais. Isso mantém o resultado compatível com o QuickJS do AthenaEnv sem usar `eval` ou gerar chamadas não documentadas.

Fontes de áudio usam as APIs reais do AthenaEnv. WAV e OGG são carregados por `Sound.Stream` como áudio global; apenas o primeiro stream ativo da cena é exportado. Arquivos ADP usam `Sound.Sfx` e aceitam volume, pan, pitch e atenuação espacial calculada pela distância do jogador. Áudio pode tocar ao iniciar ou ser controlado por ações de trigger.

Emissores de partículas usam fragmentos OBJ de baixa geometria, atualizados e desenhados pelo `main.js`. Os presets de fogo, fumaça e faíscas controlam movimento e material; emissão, vida, velocidade, dispersão, tamanho e gravidade são editáveis. O exportador distribui um orçamento global de 12 partículas entre os emissores para manter o custo previsível. Triggers podem iniciar, parar ou disparar uma explosão única.

Prefabs são armazenados em `editor/prefabs`. Ao instanciar um prefab, novos IDs são gerados e a hierarquia interna é preservada; as instâncias já colocadas continuam independentes do arquivo original.

Atalhos principais: `W` move, `E` rotaciona, `R` redimensiona, `B` ativa a seleção por caixa, `F` foca e `Delete` exclui. Use `/` para isolar a seleção, `H` para ocultá-la e `Alt+H` para revelar tudo. `Ctrl+C`, `Ctrl+V` e `Ctrl+D` copiam, colam e duplicam; `Ctrl+Z` desfaz e `Ctrl+S` salva. `Ctrl+clique` adiciona ou remove objetos da seleção.

Em qualquer ferramenta, mantenha o botão direito pressionado para ativar temporariamente a Mão e arraste para percorrer a cena; ao soltar, o gizmo anterior retorna. Arraste com o botão esquerdo em uma área vazia para alterar o ângulo e use a roda para aproximar ou afastar. A área de transferência interna persiste no navegador e aceita seleções múltiplas, grupos completos e colisores.

Materiais, animações, luzes, sombras e câmeras são salvos junto com a cena. O preview de câmera usa a proporção nativa de 640 × 448 do projeto. No runtime, os materiais são aplicados por `RenderData.updateMaterial`, texturas substitutas são passadas ao `RenderData`, os pipelines oficiais são selecionados conforme o material, luzes ambiente e direcionais entram no sistema `Lights` e a câmera principal executa o modo escolhido. Modelos GLTF/GLB podem iniciar um clipe por `AnimCollection`/`RenderObject.playAnim`.

Como o Athena atual não expõe uma luz pontual com alcance, o runtime a simula atualizando luzes direcionais antes de desenhar cada objeto. A intensidade usa a distância entre a luz e o centro espacial exportado de cada OBJ, com queda quadrática e flicker opcional. Isso permite fogueiras realmente locais sem clarear toda a cena. A precisão visual acompanha a divisão do cenário: blocos menores produzem bordas de luz mais suaves. O Athena oferece quatro slots de luz no total; o runtime compartilha esse orçamento entre luzes globais e pontuais, reservando até dois slots locais quando necessário. A opção de sombra da própria luz continua apenas no preview; sombras exportadas usam objetos **Projetor de sombra** e a API oficial `Shadows.Projector`.

A correspondência entre o editor e as APIs oficiais, além dos limites que não devem virar propriedades de cena, está registrada em [`docs/ATHENAENV-COMPATIBILITY.md`](docs/ATHENAENV-COMPATIBILITY.md).

O cenário procedural original já estava consolidado em sete blocos OBJ; eles aparecem como filhos do grupo **Cenário congelado**. Todo modelo, primitiva, grupo ou colisor adicionado pelo editor permanece independente. Os sete obstáculos originais foram migrados para o grupo **Colisões** e agora são editados visualmente.

Para validar runtime, colisões 3D e exportação hierárquica do editor, execute:

```powershell
npm test
npm run editor:check
```
