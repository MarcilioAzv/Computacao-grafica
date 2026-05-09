import { GUI } from 'lil-gui';
export function iniciarInterface(config, world, setCameraModo) {

    const estiloTatico = document.createElement('style');
    estiloTatico.innerHTML = `
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@700&family=Oswald:wght@300;400;700&display=swap');

        .lil-gui { 
            --background-color: rgb(0, 0, 0);
            --widget-color: rgba(51, 51, 51, 0.8);
            --text-color: #ffffff;                    
            --number-color: #ff0000;                     
            border: 2px solid rgba(0, 0, 0, 0.4); 
            box-shadow: 0 0 20px rgb(65, 65, 65); 
            font-family: 'Oswald', sans-serif; 
            font-size: 10px;
            text-transform: uppercase; 
            letter-spacing: 1px;       
        }

        .lil-gui .title { 
            background: rgba(51, 0, 0, 0.9);
            font-weight: bold;
            font-size: 12px;
            color: #ffffff;
            padding-top: 0.1px;
            border-bottom: 1px solid rgba(54, 54, 54, 0.33);
        }

        .lil-gui .folder .title { color: #cccccc; font-size: 10px; }
        .lil-gui .name { color: #e4e4e4; width: 50%; }

        .lil-gui .controller.add {
            background: rgba(30, 30, 30, 0.9);
            margin-top: 10px;
            border-top: 1px solid rgba(125, 125, 125, 0.89);
        }

        .lil-gui .controller.add .widget { color: #aaaaaa; justify-content: left; }
    `;
    document.head.appendChild(estiloTatico);

    const gui = new GUI({ title: 'Painel de Controle' });
    gui.width = 280;

    const pastaFisica = gui.addFolder('Cinemática');
    
    pastaFisica.add(config, 'v0', 10, 500).name('Velocidade (m/s)').step(1);
    pastaFisica.add(config, 'angle', -20, 60).name('Ângulo (°)').onChange(val => {
    // Quando você mexe no slider, ele chama a função do main.js
    if (typeof window.atualizarPitchPelaInterface === 'function') {
        window.atualizarPitchPelaInterface(val);
    }
}).listen();
    
    // Adicionamos o .onChange na gravidade para atualizar o mundo físico na hora
    pastaFisica.add(config, 'gravity', 0, 20).name('Gravidade (m/s²)').step(0.1).onChange(v => {
        if(world) world.gravity.set(0, -v, 0);
    });
    
    pastaFisica.add(config, 'wind', -20, 20).name('Vento (m/s)').step(1);

    const pastaVisual = gui.addFolder('Visualização');
    
    // Objeto temporário para as opções que não existem no config dele
    const extras = {
        tipoProjetil: 'Bala',
        corRastro: '#ffffff',
        mostrarTrajetoria: true,
        modoCamera: 'FPS'
    };

    pastaVisual.add(extras, 'modoCamera', ['FPS', 'LIVRE']).name('Modo de Câmera').onChange(val => {
        setCameraModo(val);
    });

    pastaVisual.add(extras, 'tipoProjetil', ['Bala', 'Canhão']).name('Projétil');
    pastaVisual.addColor(extras, 'corRastro').name('Cor do Traçante');
    pastaVisual.add(extras, 'mostrarTrajetoria').name('Mostrar Trajetória');

    const acoes = {
    resetar: function() {
        config.v0 = 100;
        config.angle = 0;
        config.gravity = 9.81;
        config.wind = 0;

        extras.tipoProjetil = 'Bala';
        extras.corRastro = '#ffffff';
        extras.mostrarTrajetoria = true;
        extras.modoCamera = 'FPS';

        if(typeof world !== 'undefined' && world) world.gravity.set(0, -9.81, 0);
        
        // Se a função setCameraModo existir no seu código, pode manter:
        if(typeof setCameraModo === 'function') setCameraModo('FPS');

        // ==========================================
        // Chama a ponte que arruma tudo lá no main.js
        if (typeof window.forcarResetDaCena === 'function') {
            window.forcarResetDaCena();
        }
        // ==========================================

        gui.folders.forEach(folder => {
            folder.controllers.forEach(c => c.updateDisplay());
        });
        
        gui.controllers.forEach(c => c.updateDisplay());

        console.log("Sistema Totalmente Resetado!");
    }
};

    gui.add(acoes, 'resetar').name('Resetar Sistema');
}