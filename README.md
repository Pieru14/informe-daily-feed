# IN/FORME · radar editoriale

Questo archivio pubblico contiene soltanto le edizioni editoriali di IN/FORME:
notizie di alta moda, fonti ufficiali e letture creative. Non contiene il
sito-regalo, credenziali, né le idee personali salvate nella rivista.

Ogni mattina un flusso GitHub Actions:

1. cerca esclusivamente nei domini ufficiali della watchlist;
2. pubblica un'edizione solo quando trova almeno cinque novità verificabili;
3. conserva l'ultima edizione valida quando non emergono notizie sufficienti;
4. salva una copia datata di ogni nuova edizione.

Il sito IN/FORME leggerà data/current.json direttamente da qui. Tutte le
chiavi restano nei Secrets di GitHub e non devono mai essere aggiunte ai file.

## Attivazione una tantum

Nella pagina GitHub del repository, aggiungere un Secret Actions chiamato
OPENAI_API_KEY. La chiave va creata per questo progetto e conservata solo
nel campo protetto di GitHub. Dopo averla aggiunta, aprire la scheda Actions e
avviare una volta il flusso “IN/FORME · edizione quotidiana”.

L'orario automatico è 07:37 Europe/Rome. L'uso di un minuto non tondo riduce
la probabilità di ritardi nelle ore di punta di GitHub Actions.
