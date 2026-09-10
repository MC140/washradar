# Native device test matrix

Minimum physical-device coverage before store release:

| Area | iOS | Android |
| --- | --- | --- |
| Fresh install / first location prompt | Required | Required |
| Location denied -> manual search | Required | Required |
| City/postal/full-address search | Required | Required |
| Search/sort persistence after relaunch | Required | Required |
| Update queue as guest | Required | Required |
| Second device sees queue update | Cross-device | Cross-device |
| Start wait timer at real wash | Required | Required |
| Background/lock -> resume active timer | Required | Required |
| Account create/login/logout/delete | Required | Required |
| Directions hand-off | Apple Maps + optional Google Maps | Installed Maps app |
| VoiceOver/TalkBack | VoiceOver | TalkBack |
| Large text/font scaling | Required | Required |
| Safe area / system navigation | Required | Required |
| Offline/reconnect | Required | Required |
