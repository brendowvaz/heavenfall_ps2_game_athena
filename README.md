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

O launcher usa `-elf` e define `build/dist` como raiz HostFS, impedindo que o PCSX2 abra outro jogo recente. No hardware real, copie todo o conteúdo de `build/dist` para o mesmo diretório no dispositivo usado pelo launcher e inicie `athena.elf`.

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
- primitivas de cubo, esfera, cilindro, cone e plano;
- materiais por objeto com textura, opacidade, rugosidade, metal, emissão e modo sem iluminação;
- luzes ambiente, direcionais e pontuais com gizmos, alcance, flicker e preset de fogueira;
- câmeras de cena com modos seguir, fixa e fixa olhando o jogador, além de preview em 640 × 448;
- colisores visuais de caixa, esfera e cápsula, com trigger e bloqueio de câmera;
- componentes de trigger com eventos de entrada, saída e interação executados no PS2;
- editor de interface 2D em 640 × 448 com painéis, textos, arraste e redimensionamento;
- múltiplas cenas persistentes, com seleção, duplicação, exclusão e teste da cena ativa;
- fontes de áudio WAV/OGG e efeitos ADPCM com loop, volume, pan, pitch e alcance espacial;
- emissores 3D de fogo, fumaça e faíscas com pool de partículas limitado para o PS2;
- prefabs criados a partir de qualquer seleção, incluindo grupos e colisores;
- importação múltipla de OBJ/MTL, GLTF/GLB, BIN e texturas;
- biblioteca dos modelos disponíveis no projeto;
- duplicação, exclusão, desfazer/refazer e snap por grade, superfície, vértice ou centro de objeto;
- copiar e colar modelos, grupos, primitivas e colisores com a hierarquia preservada;
- salvamento direto para o runtime e botão para testar no PCSX2.

Ao importar OBJ ou GLTF com arquivos externos, selecione também o MTL, BIN e as texturas relacionados. Eles serão copiados juntos para `assets/imported`.

Cada cena fica em `editor/scenes`, enquanto `editor/scene.json` continua como espelho compatível da cena ativa. A cena escolhida no seletor superior é exportada para `assets/scene.generated.js` e também mantém sua própria cópia em `assets/scenes`. Ao salvar ou testar, essa é a cena realmente executada pelo PS2.

O modo **Interface** trabalha nas coordenadas nativas de 640 × 448. Painéis usam `Draw.rect` e textos usam `Font` no `main.js`; posição, tamanho, cor, opacidade, conteúdo, alinhamento e escala configurados no editor entram no runtime. Arraste um elemento para posicioná-lo e use a alça inferior para redimensionar.

As dimensões dos colisores seguem a visualização do editor: na caixa, `scale` representa as meias-extensões; na esfera e na cápsula, representa os raios locais. Posição, rotação XYZ, escala hierárquica e altura são exportadas em coordenadas mundiais. Triggers são detectados sem bloquear, e **Bloquear câmera** afeta somente a câmera.

Triggers podem executar ações **Ao entrar**, **Ao sair** ou **Ao interagir** com `Triângulo`. As ações mostram mensagens na HUD, mostram/ocultam objetos ou grupos, teletransportam o jogador e controlam áudio ou partículas. Grupos usados como alvo são resolvidos para seus modelos filhos durante a exportação, e todas as ações são executadas pelo `main.js` no PS2.

Fontes de áudio usam as APIs reais do AthenaEnv. WAV e OGG são carregados por `Sound.Stream` como áudio global; apenas o primeiro stream ativo da cena é exportado. Arquivos ADP usam `Sound.Sfx` e aceitam volume, pan, pitch e atenuação espacial calculada pela distância do jogador. Áudio pode tocar ao iniciar ou ser controlado por ações de trigger.

Emissores de partículas usam fragmentos OBJ de baixa geometria, atualizados e desenhados pelo `main.js`. Os presets de fogo, fumaça e faíscas controlam movimento e material; emissão, vida, velocidade, dispersão, tamanho e gravidade são editáveis. O exportador distribui um orçamento global de 12 partículas entre os emissores para manter o custo previsível. Triggers podem iniciar, parar ou disparar uma explosão única.

Prefabs são armazenados em `editor/prefabs`. Ao instanciar um prefab, novos IDs são gerados e a hierarquia interna é preservada; as instâncias já colocadas continuam independentes do arquivo original.

Atalhos principais: `W` move, `E` rotaciona, `R` redimensiona, `B` ativa a seleção por caixa, `F` foca e `Delete` exclui. Use `/` para isolar a seleção, `H` para ocultá-la e `Alt+H` para revelar tudo. `Ctrl+C`, `Ctrl+V` e `Ctrl+D` copiam, colam e duplicam; `Ctrl+Z` desfaz e `Ctrl+S` salva. `Ctrl+clique` adiciona ou remove objetos da seleção.

Em qualquer ferramenta, mantenha o botão direito pressionado para ativar temporariamente a Mão e arraste para percorrer a cena; ao soltar, o gizmo anterior retorna. Arraste com o botão esquerdo em uma área vazia para alterar o ângulo e use a roda para aproximar ou afastar. A área de transferência interna persiste no navegador e aceita seleções múltiplas, grupos completos e colisores.

Materiais, luzes e câmeras são salvos junto com a cena. O preview de câmera usa a proporção nativa de 640 × 448 do projeto. No runtime, materiais sem iluminação selecionam o pipeline correspondente, luzes ambiente e direcionais são enviadas ao sistema `Lights` do Athena e a câmera principal executa o modo escolhido. A troca de textura é exibida no editor; no PS2, a textura efetiva ainda é resolvida pelo OBJ/MTL.

Como o Athena atual não expõe uma luz pontual com alcance, o runtime a simula atualizando luzes direcionais antes de desenhar cada objeto. A intensidade usa a distância entre a luz e o centro espacial exportado de cada OBJ, com queda quadrática e flicker opcional. Isso permite fogueiras realmente locais sem clarear toda a cena. A precisão visual acompanha a divisão do cenário: blocos menores produzem bordas de luz mais suaves. O Athena oferece quatro slots de luz no total; o runtime compartilha esse orçamento entre luzes globais e pontuais, reservando até dois slots locais quando necessário. Sombras projetadas continuam exclusivas do preview.

O cenário procedural original já estava consolidado em sete blocos OBJ; eles aparecem como filhos do grupo **Cenário congelado**. Todo modelo, primitiva, grupo ou colisor adicionado pelo editor permanece independente. Os sete obstáculos originais foram migrados para o grupo **Colisões** e agora são editados visualmente.

Para validar runtime, colisões 3D e exportação hierárquica do editor, execute:

```powershell
node tests/smoke.cjs
node tests/editor-collision.mjs
```
