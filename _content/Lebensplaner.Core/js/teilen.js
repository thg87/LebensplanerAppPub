// Teilen über die Web Share API — „Text ins OS-Share-Sheet", kein Upload, kein
// Server (Regel 1 / ADR 0003). Der geteilte Inhalt ist lesbarer Text, den das
// Betriebssystem an eine App der Wahl (Nachrichten, Notizen, …) weiterreicht.
//
// Nicht jede Plattform kann das: Desktop-Firefox etwa hat kein navigator.share,
// und die Zwischenablage verlangt einen sicheren Kontext (https/localhost). Darum
// die Fähigkeitsabfrage vorweg — der Aufrufer (US-85) zeigt den Knopf nur, wenn es
// einen Weg gibt, statt einen toten Knopf zu präsentieren (AC2).
//
// Wie indexeddb.js, datei.js, installation.js & Co. erreicht diese Datei KEIN
// Unit-Test. Geprüft wird von Hand im Browser und am Ende auf dem iPhone.

export function faehigkeit() {
    const hatNavigator = typeof navigator !== 'undefined';
    return {
        kannTeilen: hatNavigator && typeof navigator.share === 'function',
        kannKopieren: hatNavigator
            && navigator.clipboard != null
            && typeof navigator.clipboard.writeText === 'function'
    };
}

export async function teilen(titel, text) {
    try {
        await navigator.share({ title: titel, text });
        return true;
    } catch (fehler) {
        // AbortError = der Nutzer hat das Share-Sheet selbst geschlossen. Das ist
        // eine Entscheidung, kein Fehler — melden, dass nichts geteilt wurde, und
        // still bleiben. Jeder andere Fehler (z. B. kein sicherer Kontext) fliegt
        // weiter; ein leeres Schlucken verböte CLAUDE.md.
        if (fehler && fehler.name === 'AbortError') {
            return false;
        }
        throw fehler;
    }
}

export async function kopieren(text) {
    await navigator.clipboard.writeText(text);
}
