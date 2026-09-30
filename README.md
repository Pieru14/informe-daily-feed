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
Entrambi includono novità internazionali con etichetta `Globale`, senza richiedere
un'attivazione locale né affermare una distribuzione mondiale. Mattina: priorità
all'Italia; sera: priorità a USA/New York. Per le etichette locali resta necessaria
una prova: inglese, URL en-us e valuta non bastano. Pagine senza data, vecchie
aperture e store locator non sono notizie nuove. Le press room di gruppo sono
autorizzate singolarmente per brand in `publisherDomains`, non per tutti i marchi.

## Freschezza e copertura

Priorità alle pubblicazioni di oggi; ogni esecuzione ricontrolla una finestra
mobile di 48 ore (`rolling-48h-v2`) per recuperare indicizzazione tardiva o ricerche
parziali. I recuperi hanno sempre la vera data e non sono presentati come notizie
di oggi. La finestra termina all'avvio: una pubblicazione successiva verrà cercata
al controllo seguente. Non si amplia la finestra per riempire un'edizione vuota.
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

## Controllo sistematico delle fonti

Prima dell'unica richiesta GPT-5.5, `source-scan.mjs` tenta le pagine editoriali
configurate per ciascuna delle 33 maison. Prima tutti gli indici principali,
poi i secondari, infine fino a due articoli per brand: massimo sei richieste
HTTP simultanee, timeout 8 secondi, budget complessivo 120 secondi, 3 MB per pagina.
I redirect sono ammessi soltanto verso HTTPS dei domini autorizzati per quel brand.
Pagine bloccate, bot challenge, shell vuote e contenuti non editoriali non sono
considerati letti. Non vengono aggirati login o protezioni dei siti.

Gli estratti sono dati non attendibili come istruzioni. Il contesto diretto ha
un budget ripartito fra tutti i brand, non troncato a danno degli ultimi. L'AI
completa la verifica con ricerca web ufficiale (massimo 8 chiamate di ricerca),
senza richieste AI aggiuntive o cambio modello. Costi effettivi dipendono dai
token e dalle ricerche; il limite di fatturazione dell'account non viene modificato.

`data/research-italy.json` e `data/research-usa.json` registrano esiti per maison,
URL tentati, lacune e token/ricerche usati, senza chiavi né dati personali.
`radarCoverage.partial` espone le lacune anche quando sono pubblicate alcune notizie;
uno stato `partial` senza nuovi articoli non equivale a dire che non esistono notizie.
Un indice raggiungibile non garantisce una scansione esaustiva del brand.
Gli URL delle fonti controllate non entrano nella deduplicazione: solo gli
articoli effettivamente pubblicati sono aggiunti a `seen-urls`.

I controlli offline si eseguono con `npm test` e `npm run check`. Per verificare
il percorso autonomo, avviare una sola esecuzione manuale di ciascun workflow,
controllare log, report e `data/current.json`; non basta l'esito verde del job.
Se l'API fallisce si conserva l'edizione e si segnala errore, senza retry a pagamento.
La normale esecuzione successiva ricontrolla le fonti nella stessa finestra mobile.
