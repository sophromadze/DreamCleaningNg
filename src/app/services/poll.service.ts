import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';


export interface PollQuestion {
  id: number;
  question: string;
  questionType: string;
  options?: string;
  isRequired: boolean;
  displayOrder: number;
  isActive: boolean;
  serviceTypeId: number;
}

export interface PollAnswer {
  pollQuestionId: number;
  answer: string;
}

export interface PollSubmission {
  serviceTypeId: number;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone?: string;
  serviceAddress: string;
  aptSuite?: string;
  city: string;
  state: string;
  postalCode: string;
  answers: PollAnswer[];
  uploadedPhotos?: Array<{
    fileName: string;
    base64Data: string;
    contentType: string;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class PollService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getPollQuestions(serviceTypeId: number): Observable<PollQuestion[]> {
    return this.http.get<PollQuestion[]>(`${this.apiUrl}/poll/questions/${serviceTypeId}`);
  }

  submitPoll(submission: PollSubmission): Observable<any> {
    return this.http.post(`${this.apiUrl}/poll/submit`, submission);
  }
}