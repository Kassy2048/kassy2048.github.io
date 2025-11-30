/* This script file is injected in the HTML page to add these extra features:
 *  - Full-screen button
 */

{
const baseUrl = new URL(document.currentScript.src).href.replace(/\/[^\/]+$/, '');
const options = JSON.parse(atob(document.currentScript.dataset.options));

document.addEventListener('DOMContentLoaded', () => {
    if(options.addFullscreen) {
        // Add fullsreen button
        const box = document.createElement('div');
        box.style.position = 'fixed';
        box.style.top = '20%';
        box.style.right = '5px';
        box.style.userSelect = 'none';
        box.style.width = '5%';
        box.style.height = '5%';
        box.style.display = 'flex';
        box.style.justifyContent = 'right';

        const button = document.createElement('div');
        button.style.cursor = 'pointer';
        button.style.backgroundColor = 'rgba(255, 200, 200, 0.5)';
        button.style.zIndex = '65535';
        button.style.maxHeight = '100%';
        button.style.maxWidth = '100%';
        button.style.aspectRatio = '1/1';
        button.style.padding = '1px';
        button.style.overflow = 'hidden';
        button.title = 'Switch to fullscreen';

        const image = document.createElement('img');
        image.src = baseUrl + '/arrows-fullscreen.svg';
        image.style.width = '100%';
        image.style.height = '100%';

        button.appendChild(image);
        box.appendChild(button);
        document.body.appendChild(box);

        document.addEventListener('fullscreenchange', (e) => {
            if(document.fullscreenElement === null) {
                image.src = baseUrl + '/arrows-fullscreen.svg';
                button.title = 'Enter fullscreen';
            } else {
                image.src = baseUrl + '/fullscreen-exit.svg';
                button.title = 'Exit fullscreen';
            }
        });

        button.addEventListener('click', (e) => {
            if(document.fullscreenElement === null) {
                document.body.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
        });

        // Add a white backdrop so the background is not black when going to fullscreen
        const style = document.createElement('style');
        style.textContent = `
::backdrop {
    background-color: rgba(255,255,255,0);
}
        `;
        document.head.insertBefore(style, document.head.firstChild)
    }
});
}
