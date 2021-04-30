import { senators } from '../data/senators.js'
import { representatives } from '../data/representatives.js'
import { removeChildren } from '../utils/index.js'

const congressGrid = document.querySelector('.congressGrid')
const seniorityButton = document.querySelector('#senioritySort')
const birthdaySort = document.querySelector('#birthdaySort')

seniorityButton.addEventListener('click', () => senioritySort())

function populateCongressDiv(simplifiedList) {
    removeChildren(congressGrid)
    simplifiedList.forEach(person => {
        let personDiv = document.createElement('div')
        let personFig = document.createElement('figure')
        let figImage = document.createElement('img')
        let figCaption = document.createElement('figcaption')

        figImage.src= person.imgURL
        figCaption.textContent = person.name

        personFig.appendChild(figImage)
        personFig.appendChild(figCaption)
        personDiv.appendChild(personFig)
        congressGrid.appendChild(personDiv)
    });
}

function getSimplifiedPeople(peopleList) {
    return peopleList.map(person => {
        let middleName = person.middle_name ? ` ${person.middle_name}` : ``
        return {
            id: person.id,
            name: `${person.first_name} ${middleName} ${person.last_name}`,
            imgURL: `https://www.govtrack.us/static/legislator-photos/${person.govtrack_id}-200px.jpeg`,
            seniority: parseInt(person.seniority, 10)
        }
    })
}

function senioritySort () {
    populateCongressDiv(getSimplifiedPeople(senators).sort((a, b) => a.seniority - b.seniority).reverse())
}

populateCongressDiv(getSimplifiedPeople(senators))


