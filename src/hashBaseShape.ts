// Generated once on main @ 8cabf09 by `scripts/g0.ts --schema` (seeds 1, 42, 1234 at 2000 y; seed 3 at 1100 y with and
// without the standard orders). Frozen: the 8cabf09 History shape that hashBase projects onto (src/hashBase.ts). Do not edit.
export const BASE_SHAPE = {
 "o": {
  "years": 0,
  "snapshotInterval": 0,
  "snapshotCount": 0,
  "settlements": {
   "a": {
    "o": {
     "id": 0,
     "cell": 0,
     "foundedYear": 0,
     "parent": 0,
     "abandonedYear": 0,
     "name": 0,
     "people": 0,
     "outpost": 0,
     "post": 0,
     "resort": 0
    }
   }
  },
  "population": "Float32Array",
  "food": "Float32Array",
  "capacity": "Float32Array",
  "events": 0,
  "journeys": {
   "o": {
    "count": 0,
    "departYear": "Float32Array",
    "arriveYear": "Float32Array",
    "from": "Int32Array",
    "to": "Int32Array",
    "size": "Float32Array",
    "kind": "Uint8Array",
    "pathOffsets": "Uint32Array",
    "path": "Uint32Array"
   }
  },
  "structures": {
   "a": {
    "o": {
     "id": 0,
     "type": 0,
     "cell": 0,
     "settlement": 0,
     "builtYear": 0,
     "lostYear": 0
    }
   }
  },
  "landInterval": 0,
  "landSnapshotCount": 0,
  "landUse": "Uint8Array",
  "degradation": "Uint8Array",
  "road": "Uint8Array",
  "wealth": "Float32Array",
  "trade": {
   "o": {
    "count": 0,
    "a": "Int32Array",
    "b": "Int32Array",
    "openedYear": "Float32Array",
    "goodAB": "Uint8Array",
    "goodBA": "Uint8Array",
    "pathOffsets": "Uint32Array",
    "path": "Uint32Array",
    "repathCount": 0,
    "repathRoute": "Int32Array",
    "repathYear": "Int16Array",
    "repathOffsets": "Uint32Array",
    "repathPath": "Uint32Array"
   }
  },
  "tradeInterval": 0,
  "tradeSnapshotCount": 0,
  "tradeVolume": "Float32Array",
  "features": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "name": 0,
     "namedYear": 0,
     "namedBy": 0,
     "anchorCell": 0,
     "size": 0,
     "spine": {
      "a": 0
     }
    }
   }
  },
  "peoples": {
   "a": {
    "o": {
     "id": 0,
     "cradle": 0,
     "founder": 0,
     "name": 0
    }
   }
  },
  "knownYear": "Int16Array",
  "contactYear": "Int16Array",
  "technology": "Float32Array",
  "species": {
   "a": {
    "o": {
     "id": 0,
     "archetype": 0,
     "category": 0,
     "name": 0,
     "origins": {
      "a": 0
     },
     "yield": 0,
     "storability": 0,
     "clonal": 0,
     "value": 0,
     "habit": 0,
     "harm": 0
    }
   }
  },
  "speciesYear": "Int16Array",
  "speciesSource": "Int8Array",
  "crop": "Uint8Array",
  "herd": "Uint8Array",
  "cash": "Uint8Array",
  "techniques": {
   "a": {
    "o": {
     "id": 0,
     "archetype": 0,
     "name": 0,
     "species": 0
    }
   }
  },
  "techniqueYear": "Int16Array",
  "techniqueSource": "Int8Array",
  "habit": "Uint8Array",
  "stimulants": {
   "a": 0
  },
  "storable": "Uint8Array",
  "polities": {
   "a": {
    "o": {
     "id": 0,
     "name": 0,
     "qualifier": 0,
     "foundedYear": 0,
     "endedYear": 0,
     "origin": 0,
     "endCause": 0,
     "parent": 0,
     "people": 0,
     "capitals": {
      "a": 0
     },
     "capitalYears": {
      "a": 0
     },
     "hue": 0
    }
   }
  },
  "polity": "Int16Array",
  "landCells": "Uint32Array",
  "territory": "Uint16Array",
  "claimed": "Uint8Array",
  "danger": "Uint8Array",
  "wars": {
   "o": {
    "count": 0,
    "kind": "Uint8Array",
    "attacker": "Int16Array",
    "defender": "Int16Array",
    "startYear": "Int16Array",
    "endYear": "Int16Array",
    "outcome": "Uint8Array",
    "taken": "Uint16Array",
    "dead": "Float32Array"
   }
  },
  "raids": {
   "o": {
    "count": 0,
    "decade": "Int16Array",
    "settlement": "Int32Array",
    "raids": "Uint16Array",
    "wealth": "Float32Array"
   }
  },
  "tariff": "Uint8Array",
  "tariffRevenue": "Float32Array",
  "smuggleVolume": "Float32Array",
  "tradeLoss": "Uint8Array",
  "contraband": "Uint8Array",
  "piracy": "Uint8Array",
  "bonds": {
   "o": {
    "count": 0,
    "kind": "Uint8Array",
    "a": "Int16Array",
    "b": "Int16Array",
    "startYear": "Int16Array",
    "endYear": "Int16Array",
    "end": "Uint8Array"
   }
  },
  "embargoes": {
   "o": {
    "count": 0,
    "a": "Int16Array",
    "b": "Int16Array",
    "startYear": "Int16Array",
    "endYear": "Int16Array"
   }
  },
  "varieties": {
   "a": {
    "o": {
     "id": 0,
     "good": 0,
     "kind": 0,
     "source": 0,
     "people": 0,
     "maker": 0,
     "value": 0,
     "firstYear": 0
    }
   }
  },
  "deposits": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "cell": 0,
     "richness": 0,
     "foundYear": 0,
     "foundBy": 0,
     "exhaustedYear": 0,
     "variety": 0
    }
   }
  },
  "depositOutput": "Float32Array",
  "traditions": {
   "a": {
    "o": {
     "id": 0,
     "craft": 0,
     "good": 0,
     "variety": 0,
     "people": 0,
     "maker": 0,
     "bornYear": 0,
     "bornAt": 0,
     "endYear": 0,
     "parent": 0,
     "seats": {
      "a": 0
     },
     "seatFrom": {
      "a": 0
     },
     "seatTo": {
      "a": 0
     }
    }
   }
  },
  "traditionQuality": "Uint8Array",
  "industry": "Uint16Array",
  "metal": "Uint8Array",
  "longHaul": {
   "o": {
    "count": 0,
    "a": "Int32Array",
    "b": "Int32Array",
    "kind": "Uint8Array",
    "openedYear": "Int16Array",
    "closedYear": "Int16Array",
    "chart": "Int16Array",
    "goodAB": "Uint8Array",
    "goodBA": "Uint8Array",
    "pathOffsets": "Uint32Array",
    "path": "Uint32Array"
   }
  },
  "longHaulVolume": "Float32Array",
  "priceIndex": "Uint8Array",
  "mart": "Uint8Array",
  "secrets": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "subject": 0,
     "foundYear": 0,
     "foundAt": 0,
     "lostYear": 0
    }
   }
  },
  "secretHolds": {
   "o": {
    "count": 0,
    "secret": "Uint16Array",
    "people": "Int8Array",
    "polity": "Int16Array",
    "from": "Int16Array",
    "to": "Int16Array",
    "channel": "Uint8Array",
    "via": "Int32Array"
   }
  },
  "secretGuard": "Uint8Array",
  "posts": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "owner": 0,
     "host": 0,
     "settlement": 0,
     "leg": 0,
     "foundedYear": 0,
     "endedYear": 0
    }
   }
  },
  "merchantWealth": "Float32Array",
  "diseases": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "archetype": 0,
     "name": 0,
     "firstYear": 0,
     "firstSettlement": 0,
     "originPeople": 0,
     "originCell": 0,
     "mortality": 0,
     "duration": 0,
     "fade": 0,
     "sea": 0,
     "crowd": 0,
     "criticalSize": 0,
     "placeBound": 0
    }
   }
  },
  "epidemics": {
   "a": {
    "o": {
     "id": 0,
     "disease": 0,
     "startYear": 0,
     "endYear": 0,
     "origin": 0,
     "source": 0,
     "deaths": 0,
     "network": 0,
     "outbreaks": 0,
     "peoples": {
      "a": 0
     },
     "great": 0
    }
   }
  },
  "outbreaks": {
   "o": {
    "count": 0,
    "disease": "Uint8Array",
    "settlement": "Int32Array",
    "year": "Int16Array",
    "mortality": "Uint8Array",
    "source": "Int32Array",
    "via": "Uint8Array",
    "epidemic": "Int32Array"
   }
  },
  "fever": "Uint8Array",
  "feverTolerance": "Uint8Array",
  "endemic": "Uint8Array",
  "quarantines": {
   "o": {
    "count": 0,
    "settlement": "Int32Array",
    "from": "Int16Array",
    "to": "Int16Array"
   }
  },
  "rulers": {
   "a": {
    "o": {
     "id": 0,
     "name": 0,
     "regnal": 0,
     "female": 0,
     "born": 0,
     "acceded": 0,
     "ended": 0,
     "died": 0,
     "polity": 0,
     "dynasty": 0,
     "how": 0,
     "end": 0,
     "law": 0,
     "predecessor": 0,
     "person": 0,
     "parent": 0,
     "ability": 0,
     "warlike": 0,
     "piety": 0,
     "tolerance": 0,
     "faith": 0
    }
   }
  },
  "dynasties": {
   "a": {
    "o": {
     "id": 0,
     "name": 0,
     "founder": 0,
     "founded": 0,
     "ended": 0,
     "home": 0,
     "people": 0
    }
   }
  },
  "reignOffsets": "Uint32Array",
  "reignIds": "Int32Array",
  "marriages": {
   "o": {
    "count": 0,
    "a": "Int16Array",
    "b": "Int16Array",
    "dynastyA": "Int32Array",
    "dynastyB": "Int32Array",
    "year": "Int16Array",
    "endYear": "Int16Array"
   }
  },
  "unions": {
   "o": {
    "count": 0,
    "senior": "Int16Array",
    "junior": "Int16Array",
    "ruler": "Int32Array",
    "startYear": "Int16Array",
    "endYear": "Int16Array",
    "end": "Uint8Array"
   }
  },
  "successionWars": "Int32Array",
  "faiths": {
   "a": {
    "o": {
     "id": 0,
     "name": 0,
     "kind": 0,
     "parent": 0,
     "people": 0,
     "foundedAt": 0,
     "foundedYear": 0,
     "holyCity": 0,
     "zeal": 0,
     "organisation": 0,
     "appeal": 0,
     "endedYear": 0
    }
   }
  },
  "faith": "Uint8Array",
  "faithShare": "Uint8Array",
  "stateFaith": "Uint8Array",
  "holyWars": "Int32Array",
  "scenery": "Uint8Array",
  "sceneryKind": "Uint16Array",
  "sights": {
   "a": {
    "o": {
     "id": 0,
     "kind": 0,
     "cell": 0,
     "settlement": 0,
     "fromYear": 0,
     "fame": 0,
     "name": 0,
     "landmark": 0
    }
   }
  },
  "visitorFlows": {
   "o": {
    "count": 0,
    "from": "Int32Array",
    "to": "Int32Array",
    "firstYear": "Int16Array",
    "pathOffsets": "Uint32Array",
    "path": "Uint32Array",
    "rowCount": 0,
    "rowSnapshot": "Uint16Array",
    "rowPair": "Int32Array",
    "visitors": "Float32Array",
    "spend": "Float32Array"
   }
  },
  "renamings": {
   "o": {
    "count": 0,
    "settlement": "Int32Array",
    "year": "Int16Array",
    "name": {
     "a": 0
    },
    "cause": "Uint8Array",
    "form": "Uint8Array",
    "polity": "Int16Array",
    "ruler": "Int32Array",
    "dynasty": "Int32Array",
    "faith": "Int16Array",
    "people": "Int16Array",
    "previous": "Int32Array",
    "restored": "Int32Array",
    "source": "Int32Array",
    "keptBy": "Int16Array"
   }
  },
  "ideas": {
   "a": {
    "o": {
     "id": 0,
     "key": 0,
     "name": 0,
     "kind": 0,
     "prerequisites": {
      "a": 0
     },
     "technique": 0,
     "ease": 0,
     "effect": 0,
     "firstYear": 0,
     "firstPeople": 0,
     "firstSettlement": 0,
     "origins": 0
    }
   }
  },
  "ideaAdoptions": {
   "o": {
    "count": 0,
    "idea": "Uint8Array",
    "people": "Int16Array",
    "year": "Int16Array",
    "how": "Uint8Array",
    "from": "Int16Array",
    "via": "Int32Array",
    "source": "Int32Array"
   }
  },
  "landmarks": {
   "o": {
    "count": 0,
    "kind": "Uint8Array",
    "rank": "Uint8Array",
    "form": "Uint8Array",
    "variant": "Uint8Array",
    "settlement": "Int32Array",
    "cell": "Int32Array",
    "begunYear": "Int16Array",
    "completedYear": "Int16Array",
    "polity": "Int16Array",
    "ruler": "Int32Array",
    "dynasty": "Int32Array",
    "faith": "Int16Array",
    "people": "Int16Array",
    "name": {
     "a": 0
    },
    "nameTemplate": {
     "a": 0
    },
    "changeCount": 0,
    "changeLandmark": "Int32Array",
    "changeYear": "Int16Array",
    "changeState": "Uint8Array",
    "changeFaith": "Int16Array",
    "changePolity": "Int16Array",
    "changeSettlement": "Int32Array",
    "faithForm": "Uint8Array",
    "faithVariant": "Uint8Array"
   }
  },
  "orders": {
   "a": {
    "o": {
     "year": 0,
     "kind": 0,
     "actor": 0,
     "target": 0
    }
   }
  },
  "orderOutcomes": {
   "a": {
    "o": {
     "status": 0,
     "reason": 0,
     "year": 0,
     "acted": 0,
     "product": 0,
     "place": 0
    }
   }
  }
 }
} as const
