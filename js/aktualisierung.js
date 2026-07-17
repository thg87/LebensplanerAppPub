// Wartet eine neue Fassung der App darauf, übernommen zu werden?
//
// Liegt in App, nicht in Core: Der Service Worker ist Sache der Schale, kein
// Modul braucht ihn. Der Kern bleibt dünn (CLAUDE.md).
//
// Wie indexeddb.js, datei.js und installation.js erreicht diese Datei **kein**
// Unit-Test. Sie wird im Browser gegen eine *veröffentlichte* Fassung von Hand
// geprüft — in der Entwicklung ist service-worker.js ein No-op, dort wartet nie
// etwas, und alles hier bleibt still.

let wartender = null;
let ziel = null;

// Meldet nach C#, sobald eine neue Fassung bereitliegt.
function melde(arbeiter) {
    wartender = arbeiter;
    if (ziel) {
        ziel.invokeMethodAsync('NeueFassungWartet');
    }
}

export async function beobachte(dotNetRef) {
    ziel = dotNetRef;

    if (!('serviceWorker' in navigator)) {
        return;
    }

    const registrierung = await navigator.serviceWorker.getRegistration();
    if (!registrierung) {
        return;
    }

    // Schon beim Aufschlagen der Seite kann einer warten — etwa weil das Update
    // beim letzten Besuch heruntergeladen und nie übernommen wurde. Ohne diese
    // Abfrage sähe der Nutzer den Hinweis erst beim nächsten Fund, also unter
    // Umständen nie.
    if (registrierung.waiting && navigator.serviceWorker.controller) {
        melde(registrierung.waiting);
        return;
    }

    registrierung.addEventListener('updatefound', () => {
        const neuer = registrierung.installing;
        if (!neuer) {
            return;
        }

        neuer.addEventListener('statechange', () => {
            // `controller` ist der Wächter gegen einen Fehlalarm beim *ersten*
            // Besuch: Dort erreicht der Worker ebenfalls `installed`, aber das
            // ist die Erstinstallation und kein Update. „Neue Version verfügbar"
            // beim allerersten Start wäre schlicht gelogen.
            if (neuer.state === 'installed' && navigator.serviceWorker.controller) {
                melde(neuer);
            }
        });
    });

    // Der Browser sieht von sich aus nur bei Navigationen nach (und höchstens
    // alle 24 Stunden). Eine Homescreen-App navigiert kaum je — ohne dieses
    // Nachfragen bliebe ein Update tagelang unbemerkt.
    try {
        await registrierung.update();
    } catch {
        // Kein Netz. Das ist der Normalfall, kein Fehler (Regel 2) — die alte
        // Fassung läuft weiter, und beim nächsten Start wird erneut gefragt.
    }
}

export function uebernehmen() {
    // Erst neu laden, wenn der neue Worker wirklich das Ruder hat. Andersherum
    // lüde die Seite sich selbst aus dem alten Cache neu, und der Nutzer sähe
    // dieselbe Fassung wie vorher — mit dem Hinweis gleich wieder daneben.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    }, { once: true });

    if (wartender) {
        wartender.postMessage({ typ: 'UEBERNEHMEN' });
    } else {
        // Sollte nicht vorkommen — aber ein Knopf, der nichts tut, ist schlimmer
        // als einer, der neu lädt.
        window.location.reload();
    }
}

export function beende() {
    ziel = null;
    wartender = null;
}
