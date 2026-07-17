// Datei-Download. Der Browser kennt keinen anderen Weg, dem Nutzer eine erzeugte
// Datei zu geben — es gibt keinen Server, der sie ausliefern könnte (ADR 0003).
//
// Ehrlich bleiben: Auf iOS ist der Download-Weg von Safari eigenwillig. Je nach
// Version öffnet Safari die JSON-Datei in einem Tab, statt sie in „Dateien"
// abzulegen, und aus einer zum Homescreen hinzugefügten PWA heraus verhält es
// sich nochmal anders. Das hier ist der beste Weg, den die Plattform bietet —
// aber ob er auf dem Gerät des Nutzers tut, was er soll, weiß erst der Test auf
// einem echten iPhone (M5). Der Simulator lügt.

export function herunterladen(dateiname, inhalt) {
    const blob = new Blob([inhalt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = dateiname;

    // Safari ignoriert einen Klick auf ein Element, das nicht im Dokument hängt.
    // Deshalb einfügen, klicken, entfernen — nicht bloß click() aufrufen.
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Die Blob-URL hält die Datei im Speicher, bis sie freigegeben wird — nur:
    // nicht sofort. Der Klick stößt den Download an, liest den Blob aber nicht
    // zwingend synchron zu Ende; in Safari bricht ein sofortiges revoke ihn ab.
    // Der Preis fürs Warten ist etwas Speicher für ein paar Sekunden, der Preis
    // fürs Nicht-Warten ist eine leere Datei statt des einzigen Backups.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
