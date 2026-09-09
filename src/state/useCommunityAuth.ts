import {useEffect, useState} from 'react';
import {getCommunityAuthState, subscribeCommunityAuth, type CommunityAuthState} from '../services/communityAuth';

const signedOut: CommunityAuthState = {signedIn: false, email: null};

export function useCommunityAuth() {
  const [state, setState] = useState<CommunityAuthState>(signedOut);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void getCommunityAuthState().then((value) => {
      if (!active) return;
      setState(value);
      setReady(true);
    });
    const unsubscribe = subscribeCommunityAuth((value) => {
      if (!active) return;
      setState(value);
      setReady(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {...state, ready};
}
