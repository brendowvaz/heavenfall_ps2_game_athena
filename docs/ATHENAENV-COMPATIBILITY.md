# Compatibilidade com o AthenaEnv oficial

Esta integração foi revisada contra `DanielSant0s/AthenaEnv` em `main`, commit [`941a699`](https://github.com/DanielSant0s/AthenaEnv/commit/941a6990b011fe1543754c8cb4645c579e27c73b), de 9 de maio de 2026. O objetivo deste arquivo é impedir que o editor prometa uma função que o runtime oficial não oferece.

## Recursos de cena disponíveis

| Área do editor | API oficial usada no PS2 | Contrato e limites |
| --- | --- | --- |
| Modelos OBJ, GLTF e GLB | `RenderData`, `RenderObject` | OBJ importado pode ser convertido para triângulos independentes; MTL e texturas continuam suportados. |
| Materiais | `RenderData.updateMaterial`, `RenderData(mesh, texture)` | Cor, ambiente/difuso/especular, emissão, brilho, `disolve`, textura, face dupla, mapeamento, Flat/Gouraud, clipping preciso e pipelines `PL_DEFAULT`, `PL_SPECULAR` e `PL_NO_LIGHTS`. |
| Animação | `AnimCollection`, `RenderObject.playAnim` | Clipes esqueléticos de GLTF/GLB, autoplay e loop. O modelo precisa conter esqueleto/animação compatível. |
| Luzes | `Lights` | O Athena oferece quatro slots. Ambiente e direcional são nativos; luz pontual com alcance é uma aproximação por objeto, pois a API não possui posição/alcance nativos. |
| Câmera | `Render.setView`, `Render.setCamera` | FOV, planos de corte, seguir, fixa e fixa olhando o jogador. |
| Interface | `Draw`, `Font`, `Image`, `Video` | Painel, texto, PNG/BMP/JPEG e MPEG. Fontes de imagem ou TTF/OTF são aceitas pelo Athena; o importador expõe TTF/OTF e as imagens oficiais. |
| Efeitos de texto | propriedades de `Font`, `getTextSize` | Cor, escala, alinhamento, contorno ou dropshadow. Contorno e dropshadow não coexistem. |
| Áudio | `Sound.Stream`, `Sound.Sfx` | WAV/OGG para stream e ADP para SFX. Loop nativo, volume, pan e pitch; espacialização é calculada pelo jogo. |
| Vídeo | `Video`, `Video.frame` | M2V/MPG/MPEG, autoplay, loop, opacidade e ações tocar/pausar/parar. `update()` é executado a cada quadro. |
| Sombras | `Shadows.Projector` | Até quatro projetores exportados, com tamanho, grade, direção, bias, deslocamento, cor e blend. Raycast ODE não é ativado sem um `ODE.Space`. |
| Tela e diagnóstico | `Screen` e `Render.stats` | Fundo, VSync, FPS, draw calls, triângulos e VRAM usada. |
| Entrada e jogador | `Pads` | Spawn configurado no runtime ou pontos de entrada da cena com posição e orientação; raio, altura, velocidades, pulo, gravidade e movimento relativo à câmera. |
| Colisão e triggers | matemática local do projeto | Caixa, elipsoide e cápsula com transformação 3D; mensagens, visibilidade, teleporte, troca de cena, áudio, partículas e vídeo. Não são anunciados como ODE. |
| Visual scripting | QuickJS, `Pads` e componentes já documentados acima | Grafos declarativos com início, triggers, botões, temporizadores, condições, variáveis, espera e ações seguras, incluindo troca de cena. O executor limita cada disparo a 128 passos e não aceita código arbitrário. |
| Ciclo de vida das cenas | `std.loadScript` e métodos `free()` dos recursos | O catálogo aponta para uma cena gerada por arquivo. `std.loadScript` avalia cada arquivo no mesmo contexto global do QuickJS; por isso, antes da carga, o controlador reinicializa todos os contratos gerados e passa o destino diretamente para o novo ciclo. A troca faz fade, encerra o loop, libera explicitamente dados 3D, imagens, áudio e vídeo e carrega somente o arquivo de destino. A coleta não é forçada nessa fronteira: no AthenaEnv atual, `RenderObject.transform`, matrizes de ossos e vetores do esqueleto são wrappers com ponteiros emprestados para alocações dos objetos 3D; finalizá-los após `free()` corrompe o heap do QuickJS. Por isso, somente essas views emprestadas ficam alcançáveis durante a sessão; os shells de `RenderObject`/`RenderData`, suas texturas e a memória pesada das malhas continuam livres para serem liberados. O runtime QuickJS permanece ativo e `Render.init()`, `Pads.get(0)`, a fonte padrão, fontes adicionais já abertas e os quatro resultados de `Lights.new()` são criados uma vez e reutilizados durante toda a execução. |

## Formatos aceitos

- Modelos e dependências: `.obj`, `.mtl`, `.gltf`, `.glb`, `.bin`.
- Imagens realmente documentadas pelo Athena: `.png`, `.bmp`, `.jpg`, `.jpeg`.
- Fontes: `.ttf`, `.otf` ou uma fonte bitmap `.png`, `.bmp`, `.jpg`, `.jpeg`. O seletor mostra todas as imagens porque o formato do atlas é interpretado pelo próprio `Font` oficial.
- Áudio: `.wav`, `.ogg`, `.adp`.
- Vídeo MPEG: `.m2v`, `.mpg`, `.mpeg`.

WebP e TGA foram removidos do importador porque não constam como formatos suportados pelo módulo `Image` oficial.

## APIs que não são propriedades de cena

`std`, `os`, `System`, `Archive`, `IOP`, `Mutex`, `Thread`, `Timer`, `Network`, `Request`, `Socket` e `WebSocket` são serviços de programa, não dados visuais de uma cena. Expor cada função como um campo do inspector criaria controles sem semântica e código inseguro; elas continuam disponíveis para scripts escritos manualmente.

O visual scripting não expõe esses serviços como texto executável. Seus nós são uma lista fechada de comportamentos que o projeto já sabe exportar e validar. Eventos de controle usam as constantes oficiais de `Pads`; temporizadores e esperas são contados no loop do jogo, evitando depender de callbacks concorrentes durante a renderização.

`RenderBatch`, `SceneNode` e `AsyncLoader` são estratégias internas de renderização/carregamento. O editor já preserva hierarquia e exporta transformações mundiais, mas não apresenta esses detalhes como propriedades artísticas. Uma futura troca para esses módulos deve ser uma otimização mensurável do runtime, sem alterar o documento da cena.

A persistência do editor não depende de uma API do AthenaEnv: JSONs canônicos, índice e derivados gerados são coordenados por gravação atômica, fila no servidor e lock de diretório compartilhado com o processo de build. Derivados são comparados pelo conteúdo esperado e podem ser reconstruídos; uma falha nunca autoriza usar `editor/scene.json` para sobrescrever cenas canônicas existentes.

O módulo ODE oficial é uma simulação física completa. O projeto usa colisão cinemática determinística para o jogador; misturar corpos ODE sem definir massa, passos, joints e sincronização mudaria a jogabilidade. Por isso o editor não finge que os colisores atuais são corpos ODE. `Shadows.Projector.enableRaycast` também permanece desligado até existir um mundo/space ODE real.

## Validação

`npm test` cobre exportação hierárquica, materiais, animação, configurações de runtime, colisores rotacionados, cápsulas, triggers, portais, pontos de entrada, troca dinâmica de ida e volta na mesma VM, persistência atômica concorrente, visual scripting, variáveis, esperas, gerenciamento de cenas, UI, vídeo, áudio, partículas e projetores de sombra. Também confirma que fontes e slots de luz não são recriados na segunda cena. `npm run editor:check` valida a sintaxe do servidor e do cliente. O build regenera todas as cenas e usa a cena inicial em `scene.generated.js` antes de copiar o pacote para `build/dist`.
