// Läuft die App installiert (vom Homescreen) oder in einem Browser-Tab?
//
// Das ist keine Kosmetik: Im Safari-Tab löscht iOS skriptbeschreibbare Daten nach
// sieben Tagen ohne Interaktion. Wer die App im Tab benutzt, verliert seine Daten —
// und es gibt keine Serverkopie, die sie zurückholt (ADR 0003).
//
// Wie bei indexeddb.js gilt: Kein Unit-Test erreicht diese Datei. Sie wird im
// Browser von Hand geprüft.

export function zustand() {
    return {
        // Zwei Wege, weil die Plattformen sich nicht einig sind: iOS meldet den
        // Homescreen-Start über das nicht standardisierte navigator.standalone,
        // alle anderen über die display-mode-Anfrage aus dem Manifest.
        installiert: window.navigator.standalone === true
            || window.matchMedia('(display-mode: standalone)').matches
            || window.matchMedia('(display-mode: fullscreen)').matches,

        // Nur für den Anleitungstext — „Teilen → Zum Home-Bildschirm" gibt es so
        // nur auf iOS. Die User-Agent-Prüfung ist unschön und unzuverlässig, aber
        // die Alternative wäre, beide Anleitungen nebeneinander zu zeigen und den
        // Nutzer raten zu lassen, welche seine ist.
        //
        // Das iPad meldet sich seit iPadOS 13 als "MacIntel" — deshalb der zweite
        // Zweig: ein echter Mac hat keine Touch-Punkte.
        ios: /iPad|iPhone|iPod/.test(window.navigator.userAgent)
            || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
    };
}
