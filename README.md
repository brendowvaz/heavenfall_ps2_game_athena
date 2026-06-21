# Ruínas do Véu Azul — fase PS2 / AthenaEnv

Protótipo jogável de uma arena glacial inspirado nas duas imagens de referência. A fase é totalmente 3D e foi desenhada para o orçamento do PlayStation 2: uma malha estática combinada, iluminação azul e laranja gravada nos vértices e poucas chamadas de desenho.

## Controles

- Analógico esquerdo ou direcional: andar
- Analógico direito: girar a câmera sobre o ombro
- X: correr
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

O launcher usa `-elf` e define `build/dist` como raiz HostFS, impedindo que o PCSX2 abra outro jogo recente. No hardware real, copie todo o conteúdo de `build/dist` para o mesmo diretório no dispositivo usado pelo launcher e inicie `athena.elf`.

## Editor visual

Inicie o editor local no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\editor.ps1
```

Abra `http://127.0.0.1:4173/editor/` no navegador. O editor oferece:

- viewport 3D com câmera orbital e vistas superior, frontal e lateral;
- seleção pela viewport ou hierarquia;
- gizmos de posição, rotação e escala;
- inspector numérico, visibilidade, bloqueio e inclusão no runtime;
- primitivas de cubo, esfera, cilindro, cone e plano;
- importação múltipla de OBJ/MTL, GLTF/GLB, BIN e texturas;
- biblioteca dos modelos disponíveis no projeto;
- duplicação, exclusão, desfazer/refazer e transformação com snap;
- salvamento direto para o runtime e botão para testar no PCSX2.

Ao importar OBJ ou GLTF com arquivos externos, selecione também o MTL, BIN e as texturas relacionados. Eles serão copiados juntos para `assets/imported`.

O botão **Salvar cena** mantém o documento editável em `editor/scene.json` e gera `assets/scene.generated.js`. O `main.js` lê esse arquivo no AthenaEnv e aplica posição, rotação e escala a cada `RenderObject`.

Atalhos principais: `W` mover, `E` rotacionar, `R` redimensionar, `F` focar, `Delete` excluir, `Ctrl+D` duplicar, `Ctrl+Z` desfazer e `Ctrl+S` salvar.

O cenário procedural original já estava consolidado em sete blocos OBJ; eles aparecem como sete objetos editáveis. Todo modelo ou primitiva adicionado pelo editor permanece como um objeto independente. As colisões do jogador continuam definidas separadamente no código do jogo.

Para validar o runtime no computador, execute `node tests/smoke.cjs`.
