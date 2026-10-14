import {accountDestination} from './account-routes.mjs';

// Compatibility for saved links and static previews. The server redirects this URL too.
const params=new URLSearchParams(location.search);
const destination=accountDestination(params.get('view'),params.get('result'));
const mode=params.get('auth');
const target=['login','register','reset'].includes(mode)?'/auth.html?'+new URLSearchParams({mode,next:destination}):destination;
const link=document.querySelector('#workspace-redirect');
if(link)link.href=target;
location.replace(target);
