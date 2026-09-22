# IN/FORME · radar editoriale

Questo archivio pubblico contiene soltanto le edizioni editoriali di IN/FORME:
notizie di alta moda, fonti ufficiali e letture creative. Non contiene il
sito-regalo, credenziali, né le idee personali salvate nella rivista.

Ogni mattina un flusso GitHub Actions:

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

L'orario automatico è 07:37 Europe/Rome. L'uso di un minuto non tondo riduce
la probabilità di ritardi nelle ore di punta di GitHub Actions.
