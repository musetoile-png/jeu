import json, numpy as np, sys
D=json.load(open('contextes-q.json'))
def X(s,kind):
    c=s['c']; q=s['q']
    if kind=='courbe': return c
    if kind=='courbe+étendue': return c+q[:5]+[q[12]]
    if kind=='courbe+qualité': return c+q[5:]
    return c+q
def lda(Xs,y,reg=0.1):
    cls=sorted(set(y)); mu={t:Xs[y==t].mean(0) for t in cls}
    m,sd=Xs.mean(0),Xs.std(0)+1e-6
    Z=(Xs-m)/sd; muz={t:(mu[t]-m)/sd for t in cls}
    Sw=sum(((Z[y==t]-muz[t]).T@(Z[y==t]-muz[t])) for t in cls)/len(Z)+np.eye(Z.shape[1])*reg
    return cls,muz,np.linalg.inv(Sw),m,sd
def marge(M,x,att):
    cls,mu,Si,m,sd=M; z=(np.array(x)-m)/sd
    d={t:float((z-mu[t])@Si@(z-mu[t])) for t in cls}
    return d[att]-min(v for t,v in d.items() if t!=att)
for pos in ['fin','mil','tout']:
  for mode in ['seul','modele']:
    for kind in ['courbe','courbe+étendue','courbe+qualité','tout']:
      nat=[];fx=[]
      for g in ['f','m','pnj']:
        tr=[s for s in D if s['ens']=='natif' and s['mode']==mode and s['grp']!=g and (pos=='tout' or s['pos']==pos)]
        M=lda(np.array([X(s,kind) for s in tr]),np.array([s['att'] for s in tr]))
        for s in D:
          if s['grp']!=g or s['mode']!=mode or not (pos=='tout' or s['pos']==pos): continue
          if s['ens']=='faux' and not s['change']: continue
          (nat if s['ens']=='natif' else fx).append(marge(M,X(s,kind),s['att']))
      nat=np.array(nat); fx=np.array(fx); th=np.quantile(fx,0.15)
      print(pos.ljust(4),mode.ljust(6),kind.ljust(15),f'justes {100*(nat<0).mean():5.1f}% faux acc. {100*(fx<0).mean():5.1f}% | à 15% faux : justes {100*(nat<th).mean():5.1f}%  (n={len(nat)}/{len(fx)})')
