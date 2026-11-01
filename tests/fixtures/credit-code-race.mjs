import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {createBillingService} from '../../backend/billing-service.mjs';
import {createCreditCodeService} from '../../backend/credit-code-service.mjs';
const db=new DatabaseSync(workerData.path);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const billing=createBillingService(db),service=createCreditCodeService(db,{billing});
parentPort.once('message',()=>{try{const value=service.redeem({id:workerData.userId},{code:workerData.code},workerData.userId);parentPort.postMessage({fixture:'credit-code-race',status:200,amount:value.redemption.amount});}catch(error){parentPort.postMessage({fixture:'credit-code-race',status:error.status||500,message:error.message});}finally{db.close();parentPort.close();}});
parentPort.postMessage({fixture:'credit-code-race',ready:true});
