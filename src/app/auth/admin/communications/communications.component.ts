import { Component } from '@angular/core';
import { MailsComponent } from '../mails/mails.component';
import { SmsComponent } from '../sms/sms.component';

@Component({
  selector: 'app-communications',
  standalone: true,
  imports: [MailsComponent, SmsComponent],
  templateUrl: './communications.component.html',
  styleUrls: ['./communications.component.scss']
})
export class CommunicationsComponent {
  activeSubTab: 'mails' | 'sms' = 'mails';

  setSubTab(tab: 'mails' | 'sms') {
    this.activeSubTab = tab;
  }
}
