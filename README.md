Simulador de Tiro 3D (Three.js & Cannon.js)
Um simulador de estande de tiro em primeira pessoa (FPS) focado em balística e geração procedural, desenvolvido diretamente no navegador utilizando Three.js para renderização 3D e Cannon.js para simulação física.

🎯 Sobre o Projeto
Este projeto é uma experiência de tiro ao alvo 3D que gera o cenário proceduralmente (em "chunks") à medida que o jogador avança. O grande diferencial é o sistema de física realista: as balas são afetadas por gravidade (queda), exigindo que o atirador compense a mira para acertar alvos a longas distâncias (100m, 200m, 400m+).

✨ Funcionalidades
Mundo Procedural: O mapa é gerado e destruído dinamicamente em blocos (chunks) ao redor do jogador para otimizar o desempenho.

Física de Balística Realista: Os projéteis possuem cálculo de trajetória com queda gravitacional e influências ambientais em tempo real.

Modelos 3D Customizados: Carregamento assíncrono de alvos em formato .obj e texturas mapeadas por arquivos .mtl.

Hitboxes Autoajustáveis: O motor físico usa caixas de colisão calculadas com exatidão sobre os modelos visuais, incluindo ajuste diagonal para superfícies inclinadas.

Modo Debug/Raio-X: Sistema integrado para visualização e calibração das hitboxes (wireframe cyan) diretamente na tela de jogo.

Controles Imersivos: Transição fluida entre visão de câmera livre (OrbitControls) e mira travada em primeira pessoa (PointerLockControls).

🛠️ Tecnologias Utilizadas
HTML5 / CSS3 / JavaScript (ES6)

Three.js: Renderização gráfica, iluminação, e gerenciamento de malhas 3D.

Cannon.js: Motor de física para detecção de colisões, gravidade e rigid bodies.
<img width="1313" height="627" alt="image" src="https://github.com/user-attachments/assets/6fa663ab-84bd-4789-a2fc-679b62bfa43a" />
