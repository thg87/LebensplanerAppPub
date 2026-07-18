// IndexedDB-Zugriff. Die einzige Stelle im Projekt, die `indexedDB` anfassen darf.
//
// Objekte gehen als JSON-String über die Interop-Grenze, nicht als strukturierte
// Objekte: So bestimmt C# die Serialisierung (Feldnamen, DateOnly-Format) allein,
// statt sie sich mit Blazors Interop-Konventionen zu teilen. Bei drei Entitäten
// kostet das nichts und nimmt eine ganze Fehlerklasse aus dem Spiel.

const datenbanken = new Map();

// Namen, deren Verbindung ein Upgrade in einem anderen Tab geschlossen hat.
// Ohne diese Unterscheidung meldete jeder Folgezugriff „wurde nicht geöffnet" —
// eine Lüge, die beim Suchen in die falsche Richtung schickt.
const verdraengt = new Set();

export async function oeffnen(name, version, migrationenJson) {
    const migrationen = JSON.parse(migrationenJson);

    // Eine bestehende Verbindung würde das eigene Upgrade blockieren.
    datenbanken.get(name)?.close();
    datenbanken.delete(name);

    const db = await new Promise((erfuellen, ablehnen) => {
        const anfrage = indexedDB.open(name, version);

        anfrage.onupgradeneeded = (e) => {
            // Nur die Migrationen laufen, die diese Datenbank noch nicht gesehen hat.
            // oldVersion ist 0 bei einer frischen Datenbank — dann laufen alle.
            const offen = migrationen
                .filter((migration) => migration.version > e.oldVersion)
                .flatMap((migration) => migration.aktionen);

            nacheinander(anfrage.result, anfrage.transaction, offen, 0);
        };

        let abgeschlossen = false;

        anfrage.onsuccess = () => {
            // Nach einem onblocked-Abbruch läuft die Anfrage weiter und meldet
            // später doch Erfolg. Diese Verbindung will niemand mehr — sie stünde
            // in keiner Map, würde nie geschlossen und blockierte ab dann selbst
            // jedes weitere Upgrade.
            if (abgeschlossen) {
                anfrage.result.close();
                return;
            }
            abgeschlossen = true;
            erfuellen(anfrage.result);
        };

        anfrage.onerror = () => {
            abgeschlossen = true;
            ablehnen(anfrage.error);
        };

        // Ein zweiter Tab hält die alte Version offen. Ohne diesen Zweig würde das
        // Promise still nie erfüllt und die App hinge ohne Fehlermeldung.
        anfrage.onblocked = () => {
            abgeschlossen = true;
            ablehnen(new Error(
                `Datenbank "${name}" ist in einem anderen Tab geöffnet und blockiert das Upgrade.`));
        };
    });

    // Ein Versionswechsel in einem anderen Tab muss diese Verbindung schließen,
    // sonst blockiert sie dort das Upgrade.
    db.onversionchange = () => {
        db.close();
        datenbanken.delete(name);
        verdraengt.add(name);
    };

    verdraengt.delete(name);
    datenbanken.set(name, db);
}

// Aktionen laufen strikt nacheinander: Die nächste startet erst, wenn die vorige
// fertig ist.
//
// Das ist nicht Vorsicht, sondern Notwendigkeit. Ein Cursor liest einen Snapshot,
// und `feldVorgabeSetzen` schreibt den ganzen Datensatz zurück. Liefen zwei
// Vorgaben auf denselben Store gleichzeitig, läse die zweite ihren Snapshot, bevor
// das Update der ersten verarbeitet ist — und überschriebe deren Feld wieder.
// Zwei Felder in einer Migration, der Normalfall, verlöre still eines davon.
//
// Die versionchange-Transaktion bleibt offen, solange Anfragen ausstehen; das
// Verketten über Callbacks hält sie am Leben.
function nacheinander(db, transaktion, aktionen, i) {
    if (i >= aktionen.length) return;
    anwenden(db, transaktion, aktionen[i], () => nacheinander(db, transaktion, aktionen, i + 1));
}

function anwenden(db, transaktion, aktion, fertig) {
    switch (aktion.art) {
        case 'storeAnlegen':
            db.createObjectStore(aktion.store, { keyPath: aktion.schluesselPfad });
            fertig();
            break;

        case 'feldVorgabeSetzen':
            vorgabeSetzen(transaktion.objectStore(aktion.store), aktion, fertig);
            break;

        case 'kennungsformVereinheitlichen':
            kennungsformVereinheitlichen(transaktion, aktion, fertig);
            break;

        default:
            throw new Error(`Unbekannte Migrationsaktion "${aktion.art}".`);
    }
}

function vorgabeSetzen(store, aktion, fertig) {
    const anfrage = store.openCursor();

    anfrage.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
            fertig();
            return;
        }

        // Nur dort setzen, wo das Feld fehlt — ein bestehender Wert des Nutzers
        // wird nie überschrieben.
        if (cursor.value[aktion.feld] === undefined) {
            // Erst weiterlaufen, wenn das Update durch ist: Sonst stünde der
            // nächste Snapshot wieder vor derselben Wettlaufsituation.
            cursor.update({ ...cursor.value, [aktion.feld]: aktion.wert }).onsuccess =
                () => cursor.continue();
        } else {
            cursor.continue();
        }
    };
}

// Schreibt in jedem Datensatz eines Stores die Einträge eines Array-Feldes von der
// alten Kennungsform {"Name":X,"Basiseinheit":N} auf die generische Form
// {"Quelle":Q,"Wert":"X<trennzeichen>N"} um (US-92, Migration 10).
//
// Wie `vorgabeSetzen` läuft das über einen Cursor und strikt nacheinander: die
// nächste Zeile erst, wenn das Update der vorigen durch ist. Der Store hält im
// Regelfall genau ein Singleton-Dokument, die Schleife ist also kurz — aber die
// Regel gilt trotzdem.
function kennungsformVereinheitlichen(transaktion, aktion, fertig) {
    const anfrage = transaktion.objectStore(aktion.store).openCursor();

    anfrage.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) {
            fertig();
            return;
        }

        // Unverzichtbar: JSON-Zugriff und put()/update() werfen SYNCHRON — etwa wenn
        // ein Eintrag nicht die erwartete Form hat. Ohne dieses abort() liefe die
        // versionchange-Transaktion trotz der Exception weiter und committete, was
        // schon in ihr steht: halb umgeschriebene Haken auf einem Gerät ohne Backup
        // (CLAUDE.md). Genau dieser Fehler saß in diesem Projekt schon zweimal hier.
        try {
            const wert = cursor.value;
            const eintraege = wert[aktion.arrayFeld];

            if (Array.isArray(eintraege) && eintraege.length > 0) {
                wert[aktion.arrayFeld] = eintraege.map((eintrag) => {
                    // Fremdform ist ein Abbruchgrund, kein stiller Umbau: Ohne diese
                    // Prüfung entstünde bei fehlendem Feld die Kennung
                    // "undefined<trenner>undefined" — ein unlesbarer Schlüssel, der auf
                    // einem Gerät ohne Backup als Datenverlust in Warteposition läge.
                    // Symmetrisch zu SicherungsDienst.KennungsformVereinheitlichenAnwenden.
                    if (typeof eintrag?.Name !== 'string' || typeof eintrag.Basiseinheit !== 'number') {
                        throw new Error(
                            `Ein Eintrag in "${aktion.arrayFeld}" trägt nicht die erwartete Form ` +
                            `{"Name":…,"Basiseinheit":…}.`);
                    }
                    return {
                        Quelle: aktion.quelle,
                        Wert: `${eintrag.Name}${aktion.trennzeichen}${eintrag.Basiseinheit}`
                    };
                });
                cursor.update(wert).onsuccess = () => cursor.continue();
            } else {
                // Leeres oder fehlendes Feld: kein Haken, nichts umzuschreiben — und
                // kein erfundener Eintrag.
                cursor.continue();
            }
        } catch (fehler) {
            transaktion.abort();
            throw fehler;
        }
    };
}

function datenbank(name) {
    const db = datenbanken.get(name);

    if (!db) {
        throw new Error(verdraengt.has(name)
            ? `Datenbank "${name}" wurde von einer neueren Version in einem anderen Tab abgelöst. Die Seite muss neu geladen werden.`
            : `Datenbank "${name}" wurde nicht geöffnet.`);
    }

    return db;
}

function store(name, storeName, modus) {
    return datenbank(name).transaction(storeName, modus).objectStore(storeName);
}

function alsPromise(anfrage) {
    return new Promise((erfuellen, ablehnen) => {
        anfrage.onsuccess = () => erfuellen(anfrage.result);
        anfrage.onerror = () => ablehnen(anfrage.error);

        // Eine Transaktion kann abbrechen, ohne dass die Anfrage selbst einen Fehler
        // meldet — etwa unter Quota-Druck oder durch ein parallel laufendes Upgrade.
        // Ohne diesen Zweig würde das Promise nie erfüllt, und der await in C# kehrte
        // nie zurück: kein Fehler, kein Timeout, nur eine still hängende UI.
        anfrage.transaction.onabort = () => ablehnen(
            anfrage.transaction.error ?? new Error('Die Transaktion wurde abgebrochen.'));
    });
}

export async function alle(name, storeName) {
    const objekte = await alsPromise(store(name, storeName, 'readonly').getAll());
    return objekte.map((o) => JSON.stringify(o));
}

export async function holen(name, storeName, schluessel) {
    const objekt = await alsPromise(store(name, storeName, 'readonly').get(schluessel));
    return objekt === undefined ? null : JSON.stringify(objekt);
}

export async function speichern(name, storeName, json) {
    await alsPromise(store(name, storeName, 'readwrite').put(JSON.parse(json)));
}

export async function loeschen(name, storeName, schluessel) {
    await alsPromise(store(name, storeName, 'readwrite').delete(schluessel));
}

// Leert die genannten Stores und füllt sie neu — in EINER Transaktion.
//
// Das ist der Kern des Imports: Bricht irgendetwas ab, macht IndexedDB die ganze
// Transaktion rückgängig, und die alten Daten stehen unverändert da. Ein „erst
// leeren, dann schreiben" über mehrere Transaktionen könnte dazwischen scheitern
// und den Nutzer ohne Daten zurücklassen — es gibt keine Serverkopie.
export async function ersetzenAlles(name, inhalteJson) {
    const inhalte = JSON.parse(inhalteJson);
    const storeNamen = Object.keys(inhalte);
    if (storeNamen.length === 0) return;

    const transaktion = datenbank(name).transaction(storeNamen, 'readwrite');

    await new Promise((erfuellen, ablehnen) => {
        transaktion.oncomplete = () => erfuellen();
        transaktion.onabort = () => ablehnen(
            transaktion.error ?? new Error('Der Import wurde abgebrochen; die Daten sind unverändert.'));
        transaktion.onerror = () => ablehnen(transaktion.error);

        try {
            for (const storeName of storeNamen) {
                const zielStore = transaktion.objectStore(storeName);
                zielStore.clear();
                for (const json of inhalte[storeName]) {
                    zielStore.put(JSON.parse(json));
                }
            }
        } catch (fehler) {
            // Unverzichtbar: put() und JSON.parse() werfen SYNCHRON — put() etwa mit
            // DataError, wenn ein Datensatz das Schlüsselfeld nicht hat. Ohne dieses
            // abort() liefe die Transaktion trotz der Exception weiter und
            // committete, was schon in ihr steht: das clear() und die Datensätze bis
            // zum kaputten. Der Nutzer stünde nach einem gescheiterten Import mit
            // halben Daten da — durch die Funktion, die sein Backup einspielen soll.
            // Genau so gesehen, im Browser, bevor dieses abort() hier stand.
            transaktion.abort();
            ablehnen(fehler);
        }
    });
}
