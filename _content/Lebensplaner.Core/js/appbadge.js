// App-Icon-Badge (Badging API) — legt eine lokale Zahl aufs Homescreen-Icon, mehr
// nicht. KEIN Push, KEIN Server, KEINE Benachrichtigung (Regel 1 / ADR 0003, ADR
// 0008): navigator.setAppBadge malt bloß eine Zahl aufs bereits installierte Icon.
// WELCHE Zahl gesetzt wird, entscheidet der Aufrufer (US-160) — hier ist nur der
// Ausspielweg samt Feature-Detection.
//
// Nicht jede Plattform kennt die Badging API: Desktop-Firefox und ältere Safari
// haben sie gar nicht, und in der EU-Region ist das Homescreen-Badge womöglich per
// DMA deaktiviert (das klärt US-161 am echten Gerät, nicht dieser Code). Fehlt die
// API, ist jede Funktion ein stiller no-op statt eines Fehlers — der Aufrufer soll
// die Zahl setzen dürfen, ohne vorher zu fragen, und darf dabei nicht abstürzen. Das
// ist keine geschluckte Ausnahme (CLAUDE.md), sondern eine bewusste Fähigkeitsprüfung
// vorweg: 'setAppBadge' in navigator.
//
// Wie indexeddb.js, teilen.js, installation.js & Co. erreicht diese Datei KEIN
// Unit-Test. Geprüft wird von Hand im Browser und am Ende auf dem iPhone (US-161).

export async function setzen(anzahl) {
    if (!('setAppBadge' in navigator)) {
        return;
    }
    await navigator.setAppBadge(anzahl);
}

export async function loeschen() {
    if (!('clearAppBadge' in navigator)) {
        return;
    }
    await navigator.clearAppBadge();
}
