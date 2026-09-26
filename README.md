# IN/FORME · radar editoriale

Questo archivio pubblico contiene soltanto le edizioni editoriali di IN/FORME:
notizie di alta moda, fonti ufficiali e letture creative. Non contiene il
sito-regalo, credenziali, né le idee personali salvate nella rivista.

Ogni giorno alle 10:30 Europe/Rome il radar principale di GitHub Actions:

1. cerca esclusivamente nei domini ufficiali della watchlist;
2. pubblica da una a dieci novità verificabili, senza riempitivi;
3. conserva l'ultima edizione valida quando non emergono nuove notizie;
4. salva una copia datata di ogni nuova edizione;
5. genera anche un breve pensiero motivazionale originale, nella stessa richiesta
   GPT-5.5. Il campo `dailyNote` cambia una volta al giorno (Europe/Rome), anche
   quando non ci sono abbastanza notizie: le date delle notizie restano invariate.

Il feed espone `checkedAt`, `checkStatus` e `checkedSourceCount` separatamente da
`updatedAt`: un controllo senza novità non cambia la data dell'edizione. Anche
gli errori vengono segnalati, conservando gli ultimi contenuti validi. Il flusso
salva inoltre `runtime.json`, senza credenziali o dettagli sensibili.
Se la deduplicazione elimina notizie della bozza, si pubblicano quelle nuove
e si conserva il precedente taccuino creativo, con la propria data distinta.

I pensieri sono testi creativi generici, non citazioni. Nomi, firme e dediche
personali restano esclusivamente nel sito privato, mai in questo feed pubblico.
Se la richiesta AI fallisce si conserva l'ultimo contenuto, con la sua data reale.

Il sito IN/FORME leggerà data/current.json direttamente da qui. Tutte le
chiavi restano nei Secrets di GitHub e non devono mai essere aggiunte ai file.

## Attivazione una tantum

Nella pagina GitHub del repository, aggiungere un Secret Actions chiamato
OPENAI_API_KEY. La chiave va creata per questo progetto e conservata solo
nel campo protetto di GitHub. Dopo averla aggiunta, aprire la scheda Actions e
avviare una volta il flusso “IN/FORME · edizione quotidiana”.

## Due radar autonomi

- Radar principale: 10:30 Europe/Rome, GPT-5.5; maison, notizie e taccuino creativo.
- Radar New York / USA: 18:30 Europe/Rome, GPT-5.5; comunicazione pubblica,
  campagne, eventi, NYFW delle maison. Missoni è esclusa dalle ricerche.

Entrambi gli orari sono italiani, con cambio automatico ora legale/solare.
GitHub Actions può partire in ritardo: questi sono orari programmati, non SLA.
I radar funzionano nel cloud senza aprire chat o computer. Richiedono credito API.
Ci sono due richieste AI al giorno, non due ricerche complete in ogni esecuzione.

Il radar serale modifica soltanto `newYorkDesk` in `data/current.json`, con
date, fonti, deduplicazione e storico propri. Non cambia le notizie, le date,
il pensiero o il taccuino del mattino. Il radar mattutino conserva il desk serale.
I due flussi condividono un blocco di scrittura e recuperano il ramo aggiornato
dopo l'attesa, evitando di sovrascriversi.

Entrambi i radar usano la stessa watchlist ampia in `config/competitors.json`
e lo stesso brief in `scripts/competitor-research.mjs`: 33 brand, fra cui Prada,
Gucci, Dior, Chanel, Louis Vuitton, Fendi e le altre maison internazionali.
Il nome tecnico del file è storico: la selezione non è limitata ai concorrenti
di una singola azienda. Non è un elenco esaustivo di tutti i brand esistenti.
Missoni è esclusa sia dai domini di ricerca sia dagli aggiornamenti proposti.
Il radar mattutino cerca iniziative nel mercato italiano, quello serale negli USA. Non è un monitoraggio completo di tutti i
brand o social. Ogni notizia deve avere fonte ufficiale emersa nella ricerca,
data originale di pubblicazione verificabile e un legame con il mercato osservato.
Inglese, URL en-us o prezzo in dollari non bastano. Pagine senza data, vecchie
aperture e store locator sono riferimenti, non nuove notizie.

## Freschezza e copertura

Priorità alle pubblicazioni di oggi; si recuperano anche quelle uscite dopo
l'ultimo controllo riuscito del rispettivo radar. La ricerca termina all'istante
di avvio: una pubblicazione successiva verrà cercata al controllo seguente.
All'avvio senza storico si usano 48 ore; dopo interruzioni il recupero è limitato
a sette giorni, senza ampliare la finestra per riempire un'edizione vuota.
Quando la fonte indica soltanto il giorno, si include l'intero giorno iniziale
e si dichiara che l'ora non è disponibile. Non si inventa precisione al minuto.

Ogni nuova scheda contiene `publishedOn`, `publishedAt` (null se non documentato)
e `publicationEvidence`. Data dell'evento, stagione, scansione e copyright non
valgono come data di pubblicazione. Le nuove schede sono ordinate per pubblicazione.
Le edizioni precedenti rimangono conservate senza essere ridatate.
`radarCoverage` distingue la lista configurata dalle maison con fonti emerse
nella ricerca e dalle lacune. Una fonte emersa non garantisce che tutto il sito
o ogni notizia del brand sia stato controllato.

Il desk distingue fatti, lettura editoriale della comunicazione e spunti
operativi. Non contiene dati interni, intenzioni dei brand o metriche inventate.
`checkedAt` indica il controllo; `updatedAt` l'ultimo inserimento. Nei giorni
senza novità, le schede precedenti conservano le date reali. Le lacune di
copertura e gli errori vengono mostrati senza cancellare contenuti validi.
