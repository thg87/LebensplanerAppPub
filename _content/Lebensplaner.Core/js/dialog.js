// Dialog/Sheet-Baustein (US-28): kapselt showModal()/close() — Blazor bindet
// das <dialog>-Element nicht direkt, das geht nur über JS-Interop.
//
// Ein Klick auf den Hintergrund schließt bewusst NICHT von selbst: Es gibt
// hier keinen Listener dafür. <dialog> tut das ohnehin nicht ungefragt — genau
// die Zurückhaltung, die die Story verlangt (kein impliziter Datenverlust bei
// ungespeicherten Eingaben).
//
// Escape löst nativ das 'close'-Ereignis aus; derselbe Weg wie ein
// Schließen-Knopf, der schliessen() ruft. Beide melden sich über genau dieses
// eine Ereignis an C# zurück — eine einzige Quelle, unabhängig davon, wie
// geschlossen wurde.

const gemerkteListener = new WeakMap();

export function aktivieren(element, dotNetRef) {
    const aufSchliessen = () => {
        dotNetRef.invokeMethodAsync('Geschlossen');
    };

    element.addEventListener('close', aufSchliessen);
    gemerkteListener.set(element, aufSchliessen);
}

export function oeffnen(element) {
    if (!element.open) {
        element.showModal();
    }
}

export function schliessen(element) {
    if (element.open) {
        element.close();
    }
}

export function deaktivieren(element) {
    const aufSchliessen = gemerkteListener.get(element);
    if (!aufSchliessen) {
        return;
    }

    element.removeEventListener('close', aufSchliessen);
    gemerkteListener.delete(element);
}
